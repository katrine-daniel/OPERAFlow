'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiSend, ClientApiError } from '@/lib/client';
import { Card, Field, buttonClass, inputClass } from '@/components/ui';
import type { Env } from '../../page';
import type { ScenarioFull } from './page';

const EXAMPLE = {
  variables: { city: 'Dubai' },
  steps: [
    { action: 'goto', path: '/' },
    { action: 'fill', selector: '#destination', value: '{{city}}' },
    { action: 'fill', selector: '#checkin', value: '{{date:+30}}' },
    { action: 'fill', selector: '#checkout', value: '{{date:+33}}' },
    { action: 'click', selector: 'button[type=submit]' },
    { action: 'expectCount', selector: '.hotel-card', min: 1 },
    { action: 'screenshot', name: 'results' },
  ],
};

const ACTIONS = 'goto(path) · fill(selector,value) · select(selector,value) · check · click · press(key) · waitFor · expectVisible · expectHidden · expectText(selector,contains) · expectCount(selector,min,max) · expectUrl(contains) · extract(selector,as) · screenshot(name)';

export function ScenarioEditor({ scenario, environments, canManage }: { scenario: ScenarioFull; environments: Env[]; canManage: boolean }) {
  const router = useRouter();
  const initial = scenario.config && Object.keys(scenario.config as object).length ? JSON.stringify(scenario.config, null, 2) : '';
  const [json, setJson] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let config: unknown;
    try {
      config = json.trim() ? JSON.parse(json) : undefined;
    } catch (err) {
      setMsg({ ok: false, text: `Steps are not valid JSON: ${(err as Error).message}` });
      return;
    }
    try {
      await apiSend('PATCH', `/testing/scenarios/${scenario.id}`, {
        name: f.get('name'),
        description: f.get('description') || null,
        isCritical: f.get('isCritical') === 'on',
        isActive: f.get('isActive') === 'on',
        viewports: f.getAll('viewports'),
        cron: f.get('cron') || null,
        timezone: f.get('timezone'),
        environmentId: f.get('environmentId') || null,
        ...(config !== undefined && { config }),
      });
      setMsg({ ok: true, text: 'Saved' });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ClientApiError ? (err.issues.length ? err.issues.map((i) => `${i.path}: ${i.message}`).join(' · ') : err.message) : 'Failed' });
    }
  }

  const eligible = environments.filter((e) => !scenario.mutatesBookings || (e.kind === 'SANDBOX' && e.allowBookingMutations));

  return (
    <form onSubmit={onSubmit} className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <Card title="Steps">
        <div className="space-y-2 p-4">
          <p className="text-[12px] text-ink-3">{ACTIONS}</p>
          <p className="text-[12px] text-ink-3">Values support {'{{variable}}'}, {'{{date:+30}}'} / {'{{date:+30:DD/MM/YYYY}}'}, {'{{secret.key}}'} (environment credentials) and {'{{extracted.name}}'}.</p>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            readOnly={!canManage}
            rows={24}
            spellCheck={false}
            placeholder="No steps configured. Selectors depend on your booking website."
            className={`${inputClass} h-auto py-2 font-mono text-[12px] leading-5`}
          />
          {canManage && (
            <button type="button" onClick={() => setJson(JSON.stringify(EXAMPLE, null, 2))} className="text-[12.5px] text-brand hover:underline">
              Insert example (search journey; adjust selectors to your site)
            </button>
          )}
        </div>
      </Card>
      <Card title="Settings" className="self-start">
        <fieldset disabled={!canManage} className="space-y-3 p-4">
          <Field label="Name"><input name="name" defaultValue={scenario.name} className={inputClass} /></Field>
          <Field label="Description"><textarea name="description" rows={2} defaultValue={scenario.description ?? ''} className={`${inputClass} h-auto py-2`} /></Field>
          <div className="flex gap-4 text-[12.5px]">
            {['desktop', 'mobile'].map((v) => <label key={v} className="flex items-center gap-1"><input type="checkbox" name="viewports" value={v} defaultChecked={scenario.viewports.includes(v)} /> {v}</label>)}
          </div>
          <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" name="isCritical" defaultChecked={scenario.isCritical} /> Critical (alerts admins and QA on failure)</label>
          <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" name="isActive" defaultChecked={scenario.isActive} /> Active</label>
          <Field label="Schedule (cron, optional)" hint='e.g. "0 6 * * *" daily at 06:00. Needs the worker (Redis) to run.'>
            <input name="cron" defaultValue={scenario.cron ?? ''} className={`${inputClass} font-mono`} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Timezone"><input name="timezone" defaultValue={scenario.timezone} className={inputClass} /></Field>
            <Field label="Scheduled environment">
              <select name="environmentId" defaultValue={scenario.environment?.id ?? ''} className={inputClass}>
                <option value="">—</option>
                {eligible.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
          </div>
          {msg && <p className={`rounded-md px-3 py-2 text-[12.5px] ${msg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>{msg.text}</p>}
          {canManage && <button className={buttonClass.primary}>Save scenario</button>}
        </fieldset>
      </Card>
    </form>
  );
}
