import { readFile } from 'fs-extra';
import path from 'path';

/**
 * Dynamically extracts the TypeScript interfaces, method signatures,
 * and JSDoc comments from the core framework classes.
 * This ensures the AI Agents always have the latest, deepest understanding
 * of the "full logics" of the framework at runtime.
 */
export class FrameworkApiExtractor {
  
  public static async extractApiDocs(): Promise<string> {
    const srcDir = path.resolve(process.cwd(), 'src', 'framework');
    
    const filesToExtract = [
      'CommonActions.ts',
      'DataEngine.ts',
      'ApiEngine.ts',
      'WaitHelpers.ts'
    ];

    let combinedApiDoc = '=========================================\nFRAMEWORK API DOCUMENTATION\n=========================================\n\n';

    for (const file of filesToExtract) {
      try {
        const filePath = path.join(srcDir, file);
        const fileContent = await readFile(filePath, 'utf-8');
        combinedApiDoc += this.parseClassApi(file, fileContent);
      } catch (err) {
        // Silently skip if file is missing
      }
    }

    return combinedApiDoc;
  }

  private static parseClassApi(fileName: string, content: string): string {
    let result = `--- File: ${fileName} ---\n`;
    
    // Extract exported interfaces
    const interfaceRegex = /export\s+interface\s+\w+\s*\{[\s\S]*?\n\}/g;
    let match;
    while ((match = interfaceRegex.exec(content)) !== null) {
      result += match[0] + '\n\n';
    }

    // We want to extract public methods inside the exported classes.
    // A simplistic Regex approach to grab method signatures and their JSDocs:
    const methodRegex = /(\/\*\*[\s\S]*?\*\/)\s*(?:public\s+)?async\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*:\s*Promise<([\s\S]*?)>\s*\{/g;
    
    let methodMatch;
    let hasMethods = false;
    while ((methodMatch = methodRegex.exec(content)) !== null) {
      hasMethods = true;
      const jsdoc = methodMatch[1];
      const methodName = methodMatch[2];
      const params = methodMatch[3].trim();
      const returnType = methodMatch[4].trim();

      // Clean up the params to make them compact but keep types
      const cleanParams = params.replace(/\s+/g, ' ').replace(/,\s*/g, ', ');

      result += `${jsdoc}\nasync ${methodName}(${cleanParams}): Promise<${returnType}>\n\n`;
    }

    // Also handle static methods
    const staticMethodRegex = /(\/\*\*[\s\S]*?\*\/)\s*(?:public\s+)?(?:static\s+)?(?:async\s+)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*:\s*(?:Promise<)?([\s\S]*?)(?:>)?\s*\{/g;
    let staticMatch;
    while ((staticMatch = staticMethodRegex.exec(content)) !== null) {
      const jsdoc = staticMatch[1];
      const methodName = staticMatch[2];
      const params = staticMatch[3].trim();
      const returnType = staticMatch[4].trim();

      if (content.includes(`static ${methodName}`) || content.includes(`static async ${methodName}`)) {
        hasMethods = true;
        const cleanParams = params.replace(/\s+/g, ' ').replace(/,\s*/g, ', ');
        result += `${jsdoc}\nstatic ${methodName}(${cleanParams}): ${returnType}\n\n`;
      }
    }

    return result + '\n';
  }
}
