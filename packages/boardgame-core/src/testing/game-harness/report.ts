import type { HarnessCaseResult, HarnessIssue, HarnessReport, HarnessSummary } from './types';

export function renderHarnessJsonReport(results: HarnessCaseResult[]): string {
  return JSON.stringify(buildHarnessReport(results), null, 2);
}

export function renderHarnessMarkdownReport(results: HarnessCaseResult[]): string {
  const report = buildHarnessReport(results);
  let markdown = '# Game Harness Report\n\n';
  markdown += `Generated: ${report.generatedAt}\n\n`;
  markdown +=
    '| slug | cases | steps | completed | step limit | completion | failed | warned | issue codes |\n';
  markdown += '|---|---:|---:|---:|---:|---:|---:|---:|---|\n';
  for (const summary of report.summaries) {
    const codes = Object.entries(summary.issueCodes)
      .map(([code, count]) => `${code}=${count}`)
      .join(', ');
    markdown += `| ${summary.slug} | ${summary.cases} | ${summary.steps} | ${summary.completed} | ${summary.stepLimitReached} | ${formatRate(summary.completionRate)} | ${summary.failed} | ${summary.warned} | ${codes || '-'} |\n`;
  }
  return markdown;
}

export function buildHarnessReport(results: HarnessCaseResult[]): HarnessReport {
  const issues = results.flatMap((result) => result.trace.issues);
  const reportableResults = results.map(({ finalState: _finalState, ...result }) => result);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    summaries: summarize(results),
    results: reportableResults,
    issues,
  };
}

function summarize(results: HarnessCaseResult[]): HarnessSummary[] {
  const bySlug = new Map<string, HarnessCaseResult[]>();
  for (const result of results) {
    const current = bySlug.get(result.slug) ?? [];
    current.push(result);
    bySlug.set(result.slug, current);
  }

  return [...bySlug.entries()].map(([slug, slugResults]) => {
    const issues = slugResults.flatMap((result) => result.trace.issues);
    const issueCodes: Record<string, number> = {};
    for (const issue of issues) {
      issueCodes[issue.code] = (issueCodes[issue.code] ?? 0) + 1;
    }
    return {
      slug,
      cases: slugResults.length,
      seeds: new Set(slugResults.map((result) => result.seed)).size,
      steps: slugResults.reduce((sum, result) => sum + result.trace.steps.length, 0),
      completed: slugResults.filter((result) => result.trace.terminal.completed).length,
      stepLimitReached: slugResults.filter((result) => result.trace.terminal.stepLimitReached)
        .length,
      completionRate:
        slugResults.length === 0
          ? 0
          : slugResults.filter((result) => result.trace.terminal.completed).length /
            slugResults.length,
      failed: issues.filter((issue: HarnessIssue) => issue.severity === 'fail').length,
      warned: issues.filter((issue: HarnessIssue) => issue.severity === 'warn').length,
      issueCodes,
    };
  });
}

function formatRate(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}
