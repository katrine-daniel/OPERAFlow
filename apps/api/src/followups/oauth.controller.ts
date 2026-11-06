import { BadRequestException, Controller, Get, Logger, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailClientFactory } from './mail-client.factory';
import { authorizeUrl, exchangeCode, fetchMailboxAddress, oauthConfigured, type MailProvider } from './oauth';

const COOKIE = 'of_oauth';
const MAX_AGE_MS = 10 * 60_000;

interface OAuthState {
  state: string;
  verifier: string;
  provider: MailProvider;
  userId: string;
  exp: number;
}

function provider(p: string): MailProvider {
  if (p !== 'google' && p !== 'microsoft') throw new BadRequestException('Unknown provider');
  return p;
}

/**
 * Authorisation-code flow with PKCE and a state value bound to the signed-in admin via an encrypted,
 * short-lived httpOnly cookie. Refresh tokens are stored encrypted; the mailbox address is read from the
 * provider, never taken from the request.
 */
@Controller('integrations/oauth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly mail: MailClientFactory,
    private readonly audit: AuditService,
  ) {}

  @Get(':provider/start')
  @RequirePermissions('integrations:manage')
  start(@Param('provider') p: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const prov = provider(p);
    if (!oauthConfigured(prov)) throw new BadRequestException(`${prov} OAuth is not configured on the server`);
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const payload: OAuthState = { state, verifier, provider: prov, userId: user.id, exp: Date.now() + MAX_AGE_MS };
    res.cookie(COOKIE, this.crypto.encrypt(JSON.stringify(payload)), { httpOnly: true, secure: env().COOKIE_SECURE, sameSite: 'lax', path: '/', maxAge: MAX_AGE_MS });
    res.redirect(302, authorizeUrl(prov, state, challenge));
  }

  @Get(':provider/callback')
  @RequirePermissions('integrations:manage')
  async callback(
    @Param('provider') p: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const prov = provider(p);
    const back = (q: string) => res.redirect(302, `${env().APP_BASE_URL.replace(/\/$/, '')}/integrations?${q}`);
    res.clearCookie(COOKIE, { path: '/' });
    if (error) return back(`oauth_error=${encodeURIComponent(error)}`);

    let saved: OAuthState;
    try {
      saved = JSON.parse(this.crypto.decrypt(String(req.cookies?.[COOKIE] ?? ''))) as OAuthState;
    } catch {
      return back('oauth_error=missing_or_invalid_state');
    }
    if (!code || !state || !CryptoService.safeEqual(state, saved.state) || saved.provider !== prov || saved.userId !== user.id || saved.exp < Date.now()) {
      await this.audit.logSafe({ actorId: user.id, action: 'integration.oauth_rejected', entityType: 'integration', metadata: { provider: prov, reason: 'state_mismatch' }, meta });
      return back('oauth_error=state_mismatch');
    }

    try {
      const tokens = await exchangeCode(prov, code, saved.verifier);
      if (!tokens.refresh_token) throw new Error('Provider did not return a refresh token (offline access not granted)');
      const mailbox = await fetchMailboxAddress(prov, tokens.access_token);
      const kind = prov === 'google' ? 'GMAIL' : 'MICROSOFT_GRAPH';
      const integ = await this.prisma.integration.upsert({
        where: { kind_mailboxAddress: { kind, mailboxAddress: mailbox } },
        create: { kind, name: mailbox, mailboxAddress: mailbox, mode: 'LIVE', status: 'CONNECTED', encryptedSecret: this.mail.storeSecret(tokens.refresh_token), ownerUserId: user.id, lastSyncAt: new Date(), config: { provider: prov } },
        update: { mode: 'LIVE', status: 'CONNECTED', encryptedSecret: this.mail.storeSecret(tokens.refresh_token), lastError: null, lastSyncAt: new Date() },
      });
      await this.audit.log({ actorId: user.id, action: 'integration.mailbox_connected', entityType: 'integration', entityId: integ.id, metadata: { provider: prov, mailbox }, meta });
      return back(`connected=${encodeURIComponent(mailbox)}`);
    } catch (err) {
      this.logger.warn(`OAuth callback failed: ${(err as Error).message}`);
      await this.audit.logSafe({ actorId: user.id, action: 'integration.oauth_failed', entityType: 'integration', metadata: { provider: prov, error: (err as Error).message.slice(0, 300) }, meta });
      return back(`oauth_error=${encodeURIComponent((err as Error).message.slice(0, 200))}`);
    }
  }
}
