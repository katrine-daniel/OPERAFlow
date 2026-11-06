import { Badge, Card, PageHeader } from './ui';

/** Honest placeholder for modules not yet delivered — no sample data is shown. */
export function ModulePending({ title, phase, summary, scope }: { title: string; phase: number; summary: string; scope: string[] }) {
  return (
    <>
      <PageHeader title={title} description={summary} actions={<Badge tone="info">Scheduled for Phase {phase}</Badge>} />
      <Card title="Planned scope">
        <ul className="grid gap-x-8 gap-y-2 px-4 py-4 text-[13px] text-ink-2 md:grid-cols-2">
          {scope.map((s) => (
            <li key={s} className="flex gap-2">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" />
              {s}
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-3 text-[12.5px] text-ink-3">
          The database schema for this module already exists. This screen intentionally shows no sample data until the module is implemented.
        </p>
      </Card>
    </>
  );
}
