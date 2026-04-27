import pc from 'picocolors';
import type { RunSummary } from '../runner/run.js';

export function printTuiSummary(summary: RunSummary): void {
  const total = summary.totalCases;
  if (total === 0) {
    console.log(pc.yellow('no evals found'));
    return;
  }

  for (const c of summary.cases) {
    const tag = c.error
      ? pc.red('ERROR')
      : c.passed
        ? pc.green('PASS ')
        : pc.red('FAIL ');
    const duration = `${(c.durationMs / 1000).toFixed(1)}s`;
    console.log(`${tag} ${c.name} ${pc.gray(`(${duration})`)}`);

    if (c.error) {
      console.log(`       ${pc.red(c.error)}`);
    } else if (!c.passed && c.verdict) {
      const missing = c.verdict.elements.filter((e) => !e.present);
      for (const m of missing) {
        console.log(`       ${pc.red('missing:')} ${m.element}`);
        console.log(`         ${pc.gray(m.reasoning)}`);
      }
    }

    if (c.traceUrl) {
      console.log(`       ${pc.gray(c.traceUrl)}`);
    }
  }

  console.log();
  const parts: string[] = [
    `${pc.green(`${summary.passed} passed`)}`,
    summary.failed > 0 ? pc.red(`${summary.failed} failed`) : `${summary.failed} failed`,
    summary.errored > 0 ? pc.red(`${summary.errored} errored`) : `${summary.errored} errored`,
    pc.gray(`(${total} total)`),
  ];
  console.log(parts.join('  '));

  if (summary.accuracy !== null) {
    const pct = (summary.accuracy * 100).toFixed(1);
    const allPass = summary.passed === summary.totalCases;
    const color = allPass ? pc.green : pc.red;
    console.log(
      `${color(`accuracy: ${pct}%`)}${pc.gray(`  (${summary.passed} of ${summary.totalCases} cases passed)`)}`,
    );
  }

  console.log(pc.gray(`run: ${summary.runId}`));
  if (summary.experimentUrl) {
    console.log(pc.gray(`experiment: ${summary.experimentUrl}`));
  }
}
