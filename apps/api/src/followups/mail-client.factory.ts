import { BadRequestException, Injectable } from '@nestjs/common';
import type { Integration } from '@operaflow/db';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { GmailClient, GraphClient, type MailboxClient } from './mail-client';
import { oauthConfigured, refreshAccessToken, type MailProvider } from './oauth';

interface StoredSecret {
  refreshToken: string;
}

/**
 * Builds a MailboxClient for a connected mailbox. Access tokens live only in memory; refresh tokens are
 * stored encrypted and rotated when the provider issues a new one (Microsoft does on every refresh).
 */
@Injectable()
export class MailClientFactory {
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  providerOf(i: Integration): MailProvider {
    if (i.kind === 'GMAIL') return 'google';
    if (i.kind === 'MICROSOFT_GRAPH') return 'microsoft';
    throw new BadRequestException('Not a mailbox integration');
  }

  forIntegration(i: Integration): MailboxClient {
    const provider = this.providerOf(i);
    if (i.mode !== 'LIVE' || !i.encryptedSecret) throw new BadRequestException(`Mailbox ${i.mailboxAddress ?? i.name} is disabled or not connected`);
    if (!oauthConfigured(provider)) throw new BadRequestException(`${provider === 'google' ? 'Google' : 'Microsoft'} OAuth app is not configured on the server`);

    const token = async (force = false) => {
      const cached = this.cache.get(i.id);
      if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
      const current = await this.prisma.integration.findUniqueOrThrow({ where: { id: i.id } });
      const secret = JSON.parse(this.crypto.decrypt(current.encryptedSecret!)) as StoredSecret;
      try {
        const t = await refreshAccessToken(provider, secret.refreshToken);
        if (t.refresh_token && t.refresh_token !== secret.refreshToken) {
          await this.prisma.integration.update({ where: { id: i.id }, data: { encryptedSecret: this.crypto.encrypt(JSON.stringify({ refreshToken: t.refresh_token })) } });
        }
        this.cache.set(i.id, { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
        return t.access_token;
      } catch (err) {
        await this.prisma.integration.update({ where: { id: i.id }, data: { status: 'ERROR', lastError: `Token refresh failed — reconnect the mailbox. ${(err as Error).message}`.slice(0, 500) } });
        throw err;
      }
    };
    return provider === 'google' ? new GmailClient(token) : new GraphClient(token);
  }

  storeSecret(refreshToken: string): string {
    return this.crypto.encrypt(JSON.stringify({ refreshToken } satisfies StoredSecret));
  }
}
