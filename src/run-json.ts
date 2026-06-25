import { readJson, pathExists } from 'fs-extra';
import path from 'path';
import { TestEngine, TestSpec } from './framework/TestEngine';
import Logger from './utils/logger';
import { FrameworkApiExtractor } from './utils/FrameworkApiExtractor';

async function main() {
  const logger = Logger.getInstance();
  const arg = process.argv[2];

  if (!arg) {
    console.error('Error: Please provide a path to a JSON test specification file.');
    console.error('Usage: npx ts-node src/run-json.ts <path-to-json-spec>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(arg);
  if (!await pathExists(resolvedPath)) {
    console.error(`Error: Spec file not found at: ${resolvedPath}`);
    process.exit(1);
  }

  try {
    console.log('\n======================================================================');
    console.log('                 HIGH-LEVEL FRAMEWORK ENGINE RUNNER                   ');
    console.log('======================================================================');
    console.log(`Loading Data-Driven JSON Spec: ${arg}\n`);

    logger.info('Initializing Dynamic Framework Capabilities...');
    const apiDocs = await FrameworkApiExtractor.extractApiDocs();
    const capabilityCount = apiDocs.split('\n').filter(line => line.includes('- `')).length;
    logger.info(`Successfully extracted ${capabilityCount} dynamic framework actions from CommonActions.ts`);

    const spec: TestSpec = await readJson(resolvedPath);
    const engine = new TestEngine();
    
    const result = await engine.runSpec(spec);

    console.log('\n======================================================================');
    console.log('                           EXECUTION SUMMARY                          ');
    console.log('======================================================================');
    console.log(`Spec Name      : ${spec.name}`);
    console.log(`Status         : ${result.passed ? 'PASS' : 'FAIL'}`);
    console.log(`Steps Executed : ${result.stepsExecuted} / ${spec.steps.length}`);
    
    if (result.error) {
      console.error(`Error Detail   : ${result.error.message}`);
      console.log('======================================================================\n');
      process.exit(1);
    } else {
      console.log('======================================================================\n');
      process.exit(0);
    }
  } catch (err) {
    console.error('Framework Engine execution failed catastrophically:', err);
    process.exit(1);
  }
}

main();
