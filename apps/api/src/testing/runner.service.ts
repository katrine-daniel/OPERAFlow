import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type TestEnvironment, type TestScenario } from '@operaflow/db';
import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '../config/env';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../bookings/storage.service';
import {
  AssertionFailure,
  assertNoRealCard,
  classifyFailure,
  ConfigError,
  environmentConfigSchema,
  hostAllowed,
  HttpError,
  interpolate,
  isPrivateHost,
  redact,
  SafetyError,
  scenarioConfigSchema,
  type Step,
} from './steps';

const DEFAULT_STEP_TIMEOUT = 15_000;
const SCENARIO_TIMEOUT = 5 * 60_000;
const MUTATING_JOURNEYS = new Set(['BOOKING_CREATE', 'BOOKING_CONFIRMATION', 'BOOKING_MODIFY', 'BOOKING_CANCEL']);

interface StepResult {
  index: number;
  action: string;
  name?: string;
  target?: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  error?: string;
}

interface Diagnostics {
  blockedRequests: { url: string; reason: string }[];
  httpErrors: { url: string; status: number }[];
  consoleErrors: string[];
  safety: string[];
  extracted: Record<string, string>;
}

/** Whether test targets on private networks are allowed (local development / CI fixtures only). */
export const allowPrivateTargets = () => env().NODE_ENV !== 'production';

/**
 * Pre-flight checks that run before any browser starts. They make it impossible to create, modify or cancel
 * a booking, or to reach anything but the configured site, outside an explicitly enabled sandbox.
 */
export function preflight(scenario: Pick<TestScenario, 'mutatesBookings' | 'journey'>, environment: Pick<TestEnvironment, 'kind' | 'allowBookingMutations' | 'baseUrl' | 'isActive'>): string[] {
  const problems: string[] = [];
  const mutates = scenario.mutatesBookings || MUTATING_JOURNEYS.has(scenario.journey);
  if (!environment.isActive) problems.push('Environment is inactive');
  if (mutates && !(environment.kind === 'SANDBOX' && environment.allowBookingMutations)) {
    problems.push('This scenario creates, modifies or cancels bookings and may only run against a SANDBOX environment with booking mutations enabled');
  }
  let url: URL;
  try {
    url = new URL(environment.baseUrl);
  } catch {
    return [...problems, 'Environment base URL is invalid'];
  }
  if (url.protocol !== 'https:' && !(allowPrivateTargets() && isPrivateHost(url.hostname))) problems.push('Environment must use https');
  if (isPrivateHost(url.hostname) && !allowPrivateTargets()) problems.push('Private/internal network targets are not allowed');
  return problems;
}

@Injectable()
export class RunnerService {
  private readonly logger = new Logger(RunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
  ) {}

  /** Executes a queued run. Idempotent: a run that is not QUEUED is left alone. */
  async execute(runId: string): Promise<void> {
    const claimed = await this.prisma.testRun.updateMany({ where: { id: runId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
    if (claimed.count === 0) return;
    const run = await this.prisma.testRun.findUniqueOrThrow({ where: { id: runId }, include: { scenario: true, environment: true } });
    const started = Date.now();
    const steps: StepResult[] = [];
    const diag: Diagnostics = { blockedRequests: [], httpErrors: [], consoleErrors: [], safety: [], extracted: {} };
    const screenshots: { name: string; buf: Buffer }[] = [];
    let secrets: Record<string, string> = {};
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    let traceDir: string | undefined;
    let status: 'PASSED' | 'FAILED' | 'ERROR' | 'BLOCKED_SAFETY' = 'PASSED';
    let failureClass: ReturnType<typeof classifyFailure> | null = null;
    let errorMessage: string | null = null;

    try {
      const problems = preflight(run.scenario, run.environment);
      if (problems.length) {
        diag.safety.push(...problems);
        throw new SafetyError(problems.join('; '));
      }
      const parsed = scenarioConfigSchema.safeParse(run.scenario.config);
      if (!parsed.success) throw new ConfigError(`Scenario is not configured: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      const config = parsed.data;
      const envConfig = environmentConfigSchema.parse(run.environment.config ?? {});
      if (run.environment.encryptedSecret) secrets = JSON.parse(this.crypto.decrypt(run.environment.encryptedSecret)) as Record<string, string>;
      const base = new URL(run.environment.baseUrl);
      const readOnly = run.environment.kind === 'PRODUCTION_READONLY';
      const ictx = { variables: config.variables, secrets, extracted: diag.extracted, now: new Date() };

      // Validate every step's resolved values before touching the site.
      for (const s of config.steps) if (s.action === 'fill') assertNoRealCard(interpolate(s.value.replace(/\{\{\s*extracted\.[^}]+\}\}/g, ''), ictx));

      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({
        ...(run.viewport === 'mobile' ? devices['iPhone 13'] : { viewport: { width: 1366, height: 800 } }),
        locale: 'en-GB',
        acceptDownloads: false,
        serviceWorkers: 'block',
      });
      await context.tracing.start({ screenshots: true, snapshots: true });
      await context.route('**/*', async (route) => {
        const req = route.request();
        let u: URL;
        try {
          u = new URL(req.url());
        } catch {
          return route.abort();
        }
        if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
        if (!hostAllowed(u.hostname, base.hostname, envConfig.allowedHosts)) {
          if (diag.blockedRequests.length < 50) diag.blockedRequests.push({ url: `${u.origin}${u.pathname}`, reason: 'host not allowed' });
          return route.abort('blockedbyclient');
        }
        if (readOnly && req.method() !== 'GET' && req.method() !== 'HEAD' && !envConfig.allowedWritePaths.some((p) => u.pathname.startsWith(p))) {
          if (diag.blockedRequests.length < 50) diag.blockedRequests.push({ url: `${u.origin}${u.pathname}`, reason: `${req.method()} blocked on read-only environment` });
          return route.abort('blockedbyclient');
        }
        return route.continue();
      });
      page = await context.newPage();
      page.on('response', (r) => {
        if (r.status() >= 500 && diag.httpErrors.length < 50) diag.httpErrors.push({ url: r.url().split('?')[0]!, status: r.status() });
      });
      page.on('console', (m) => {
        if (m.type() === 'error' && diag.consoleErrors.length < 30) diag.consoleErrors.push(redact(m.text(), secrets).slice(0, 300));
      });

      const deadline = started + SCENARIO_TIMEOUT;
      for (const [i, step] of config.steps.entries()) {
        const t0 = Date.now();
        const record: StepResult = { index: i, action: step.action, name: step.name, target: 'selector' in step ? step.selector : step.action === 'goto' ? step.path : undefined, status: 'passed', durationMs: 0 };
        steps.push(record);
        try {
          if (Date.now() > deadline) throw Object.assign(new Error(`Scenario exceeded ${SCENARIO_TIMEOUT / 1000}s`), { name: 'TimeoutError' });
          await this.runStep(page, step, base, ictx, screenshots);
          record.durationMs = Date.now() - t0;
        } catch (err) {
          record.status = 'failed';
          record.durationMs = Date.now() - t0;
          record.error = redact((err as Error).message, secrets).split('\n')[0]!.slice(0, 500);
          throw err;
        }
      }
    } catch (err) {
      failureClass = classifyFailure(err);
      status = failureClass === 'SAFETY_GUARD' ? 'BLOCKED_SAFETY' : failureClass === 'ENVIRONMENT' ? 'ERROR' : 'FAILED';
      errorMessage = redact((err as Error).message, secrets).slice(0, 2000);
      if (page) {
        const buf = await page.screenshot({ fullPage: true }).catch(() => null);
        if (buf) screenshots.push({ name: 'failure', buf });
      }
    } finally {
      if (context) {
        try {
          traceDir = await mkdtemp(join(tmpdir(), 'of-trace-'));
          const tracePath = join(traceDir, 'trace.zip');
          await context.tracing.stop({ path: tracePath });
          const buf = await readFile(tracePath);
          await this.saveArtifact(run.id, 'TRACE', buf);
        } catch (err) {
          this.logger.warn(`trace save failed for ${run.id}: ${(err as Error).message}`);
        }
      }
      for (const s of screenshots) await this.saveArtifact(run.id, 'SCREENSHOT', s.buf).catch(() => undefined);
      await browser?.close().catch(() => undefined);
      if (traceDir) await rm(traceDir, { recursive: true, force: true }).catch(() => undefined);
    }

    // Steps that never ran are listed as skipped so the report shows the whole scenario.
    const total = scenarioConfigSchema.safeParse(run.scenario.config);
    if (total.success) for (let i = steps.length; i < total.data.steps.length; i++) steps.push({ index: i, action: total.data.steps[i]!.action, name: total.data.steps[i]!.name, status: 'skipped', durationMs: 0 });

    await this.prisma.testRun.update({
      where: { id: run.id },
      data: {
        status,
        failureClass,
        errorMessage,
        steps: steps as unknown as Prisma.InputJsonValue,
        diagnostics: { ...diag, extracted: Object.fromEntries(Object.entries(diag.extracted).map(([k, v]) => [k, redact(v, secrets)])) } as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
        durationMs: Date.now() - started,
      },
    });

    if (status !== 'PASSED' && run.scenario.isCritical) {
      const recipients = await this.prisma.user.findMany({ where: { isActive: true, role: { in: ['ADMIN', 'QA'] } }, select: { id: true } });
      await this.prisma.notification.createMany({
        data: recipients.map((u) => ({
          userId: u.id,
          type: 'test.critical_failed',
          severity: 'error',
          title: `Critical test ${status === 'BLOCKED_SAFETY' ? 'blocked' : 'failed'}: ${run.scenario.name} (${run.viewport}, ${run.environment.name})`,
          body: errorMessage?.slice(0, 300),
          link: `/testing/runs/${run.id}`,
        })),
      });
    }
  }

  private async runStep(page: Page, step: Step, base: URL, ctx: Parameters<typeof interpolate>[1], shots: { name: string; buf: Buffer }[]) {
    const timeout = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT;
    const loc = (s: string) => page.locator(interpolate(s, ctx)).first();
    switch (step.action) {
      case 'goto': {
        const target = new URL(interpolate(step.path, ctx), base);
        if (!hostAllowed(target.hostname, base.hostname, [])) throw new SafetyError(`Navigation outside the environment refused: ${target.host}`);
        const res = await page.goto(target.toString(), { timeout, waitUntil: 'domcontentloaded' });
        if (res && res.status() >= 400) throw new HttpError(`GET ${target.pathname} returned HTTP ${res.status()}`);
        return;
      }
      case 'fill': {
        const value = interpolate(step.value, ctx);
        assertNoRealCard(value);
        await loc(step.selector).fill(value, { timeout });
        return;
      }
      case 'select':
        await loc(step.selector).selectOption(interpolate(step.value, ctx), { timeout });
        return;
      case 'check':
        await loc(step.selector).check({ timeout });
        return;
      case 'click':
        await loc(step.selector).click({ timeout });
        return;
      case 'press':
        if (step.selector) await loc(step.selector).press(step.key, { timeout });
        else await page.keyboard.press(step.key);
        return;
      case 'waitFor':
        await loc(step.selector).waitFor({ state: step.state, timeout });
        return;
      case 'expectVisible':
        if (!(await loc(step.selector).isVisible().catch(() => false))) {
          await loc(step.selector).waitFor({ state: 'visible', timeout }).catch(() => {
            throw new AssertionFailure(`Expected ${step.selector} to be visible`);
          });
        }
        return;
      case 'expectHidden':
        await loc(step.selector).waitFor({ state: 'hidden', timeout }).catch(() => {
          throw new AssertionFailure(`Expected ${step.selector} to be hidden`);
        });
        return;
      case 'expectText': {
        const want = interpolate(step.contains, ctx);
        const l = loc(step.selector);
        await l.waitFor({ state: 'visible', timeout }).catch(() => {
          throw new AssertionFailure(`Expected ${step.selector} to contain "${want}" but it was not found`);
        });
        const end = Date.now() + timeout;
        let text = '';
        while (Date.now() < end) {
          text = (await l.innerText()).trim();
          if (text.includes(want)) return;
          await page.waitForTimeout(150);
        }
        throw new AssertionFailure(`Expected ${step.selector} to contain "${want}", got "${text.slice(0, 200)}"`);
      }
      case 'expectCount': {
        const sel = interpolate(step.selector, ctx);
        const end = Date.now() + timeout;
        let n = 0;
        while (Date.now() < end) {
          n = await page.locator(sel).count();
          if (n >= step.min && (step.max === undefined || n <= step.max)) return;
          await page.waitForTimeout(150);
        }
        throw new AssertionFailure(`Expected ${step.min}${step.max !== undefined ? `–${step.max}` : '+'} × ${sel}, found ${n}`);
      }
      case 'expectUrl': {
        const want = interpolate(step.contains, ctx);
        await page.waitForURL((u) => u.toString().includes(want), { timeout }).catch(() => {
          throw new AssertionFailure(`Expected URL to contain "${want}", got ${page.url()}`);
        });
        return;
      }
      case 'extract': {
        const text = (await loc(step.selector).innerText({ timeout })).trim();
        if (!text) throw new AssertionFailure(`Nothing to extract from ${step.selector}`);
        ctx.extracted[step.as] = text.slice(0, 200);
        return;
      }
      case 'screenshot':
        shots.push({ name: step.name, buf: await page.screenshot({ fullPage: true }) });
        return;
    }
  }

  private async saveArtifact(runId: string, kind: 'TRACE' | 'SCREENSHOT', buf: Buffer) {
    const storageKey = await this.storage.save('test-artifacts', buf);
    await this.prisma.testArtifact.create({ data: { runId, kind, storageKey, sizeBytes: buf.length } });
  }
}
