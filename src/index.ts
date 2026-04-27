#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { loadWallyConfigForMo } from './config/wally-config.js';
import { loadEvals } from './evals/loader.js';
import { printJsonSummary } from './output/json.js';
import { printTuiSummary } from './output/tui.js';
import { runEvals } from './runner/run.js';

const program = new Command();

program.name('mo').description('Evals runner for wally agents').version('0.2.0');

program
  .command('run')
  .description('Run all evals declared by a wally config and report results')
  .requiredOption('-c, --config <path>', 'path to the wally config YAML')
  .option('-f, --filter <substring>', 'only run evals whose name contains this substring')
  .option('-j, --json', 'emit a JSON summary on stdout instead of TUI output')
  .option(
    '--concurrency <n>',
    'max parallel eval cases (default 4)',
    (v: string) => Number.parseInt(v, 10),
  )
  .action(
    async (opts: { config: string; filter?: string; json?: boolean; concurrency?: number }) => {
      try {
        const summary = await runEvals({
          configPath: opts.config,
          filter: opts.filter,
          concurrency: opts.concurrency,
        });
        if (opts.json) {
          printJsonSummary(summary);
        } else {
          printTuiSummary(summary);
        }
        const allPass = summary.failed === 0 && summary.errored === 0 && summary.totalCases > 0;
        process.exit(allPass ? 0 : 1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(pc.red(`mo: ${msg}`));
        process.exit(2);
      }
    },
  );

program
  .command('list')
  .description('List eval files declared by a wally config')
  .requiredOption('-c, --config <path>', 'path to the wally config YAML')
  .action((opts: { config: string }) => {
    try {
      const cfg = loadWallyConfigForMo(opts.config);
      const evals = loadEvals(cfg.evalsDir);
      for (const e of evals) {
        console.log(`${e.case.name}\t${e.filePath}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`mo: ${msg}`));
      process.exit(2);
    }
  });

program.parseAsync().catch((err) => {
  console.error(pc.red(`mo: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(2);
});
