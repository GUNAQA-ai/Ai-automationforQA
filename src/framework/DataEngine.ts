import { readFile, readFileSync, pathExistsSync, writeJsonSync, readJsonSync } from 'fs-extra';
import Logger from '../utils/logger';
import path from 'path';

/**
 * DataEngine - Handles Test Data Management (JSON, Excel, CSV, YAML, XML),
 * file type validations (PDF, Excel, ZIP), random data generation, 
 * and a lightweight mock database engine.
 * Upgraded to include consolidated, parameter-driven dbAction and fileAction methods.
 */
export class DataEngine {
  private static readonly logger = Logger.getInstance();

  /**
   * Consolidated Database Action (Level 17 Database Actions)
   */
  static dbAction(
    action: 'connect' | 'executeQuery' | 'executeUpdate' | 'insert' | 'delete' | 'validateData' | 'cleanupData',
    query?: string,
    params?: any[],
    options?: {
      expectedRowsCount?: number;
      expectedSubset?: Record<string, any>;
    }
  ): any {
    this.logger.info(`DataEngine: Executing DB Action "${action}"`);

    switch (action) {
      case 'connect':
        this.logger.info('Mock Database: Connected successfully to filesystem JSON database');
        return true;

      case 'executeQuery':
      case 'executeUpdate':
      case 'insert':
      case 'delete':
        if (!query) throw new Error(`Query must be specified for DB action: ${action}`);
        return this.mockDbQuery(query, params);

      case 'validateData':
        if (!query) throw new Error('Query must be specified for validateData action');
        const rows = this.mockDbQuery(query, params);
        if (options?.expectedRowsCount !== undefined) {
          if (rows.length !== options.expectedRowsCount) {
            throw new Error(`DB validation failed: expected ${options.expectedRowsCount} rows, but got ${rows.length}`);
          }
        }
        if (options?.expectedSubset && rows.length > 0) {
          const subset = options.expectedSubset;
          const match = rows.some((row: any) => {
            return Object.keys(subset).every(key => row[key] === subset[key]);
          });
          if (!match) {
            throw new Error(`DB validation failed: no row matches expected subset ${JSON.stringify(subset)}`);
          }
        }
        this.logger.info('Mock Database: Data validation passed successfully');
        return rows;

      case 'cleanupData':
        const dbFile = 'storage/mock-database.json';
        if (pathExistsSync(dbFile)) {
          writeJsonSync(dbFile, {
            users: [
              { id: 1, name: 'Guna Sekhar', email: 'guna@gmail.com', role: 'admin' },
              { id: 2, name: 'John Anderson', email: 'john.anderson@venusenergy.com', role: 'user' }
            ],
            companies: [
              { id: 101, name: 'Venus Energy Solutions LLC', country: 'United States' }
            ]
          });
          this.logger.info('Mock Database: Database successfully reset and cleaned up');
        }
        return true;

      default:
        throw new Error(`Unsupported database action: ${action}`);
    }
  }

  /**
   * Consolidated File Parser & Validator (Level 15 File Actions)
   */
  static fileAction(
    action: 'readPdf' | 'readExcel' | 'readCsv' | 'readZip' | 'verifyFileExists' | 'verifyFileName' | 'verifyContent',
    filePath: string,
    options?: {
      expectedContent?: string;
      expectedFileName?: string;
    }
  ): any {
    const resolvedPath = path.resolve(filePath);
    this.logger.info(`DataEngine: Executing File Action "${action}" on "${filePath}"`);

    const fileExists = pathExistsSync(resolvedPath);

    switch (action) {
      case 'verifyFileExists':
        if (!fileExists) throw new Error(`File does not exist: ${filePath}`);
        return true;

      case 'verifyFileName':
        const actualName = path.basename(resolvedPath);
        if (options?.expectedFileName && actualName !== options.expectedFileName) {
          throw new Error(`File name mismatch: expected "${options.expectedFileName}" but got "${actualName}"`);
        }
        return actualName;

      case 'readCsv':
        if (!fileExists) throw new Error(`CSV File not found: ${filePath}`);
        const csvContent = readFileSync(resolvedPath, 'utf8');
        return this.parseCsv(csvContent);

      case 'readPdf':
        if (!this.validatePdf(resolvedPath)) {
          throw new Error(`Invalid PDF signature or file not found: ${filePath}`);
        }
        // Return simulated parsed content
        return { pages: 1, content: 'Simulated PDF Document Content' };

      case 'readExcel':
        if (!this.validateExcel(resolvedPath)) {
          throw new Error(`Invalid Excel signature or file not found: ${filePath}`);
        }
        // Return simulated parsed sheets
        return { sheets: ['Sheet1'], data: [['Column1', 'Column2']] };

      case 'readZip':
        if (!this.validateZip(resolvedPath)) {
          throw new Error(`Invalid ZIP signature or file not found: ${filePath}`);
        }
        return { filesCount: 3, files: ['file1.txt', 'file2.txt'] };

      case 'verifyContent':
        if (!fileExists) throw new Error(`File not found for content verification: ${filePath}`);
        const content = readFileSync(resolvedPath, 'utf8');
        if (options?.expectedContent && !content.includes(options.expectedContent)) {
          throw new Error(`File content verification failed: expected text "${options.expectedContent}" not found`);
        }
        return content;

      default:
        throw new Error(`Unsupported file engine action: ${action}`);
    }
  }

  // ==========================================
  // 1. File Readers (JSON, CSV, YAML, XML)
  // ==========================================

  /**
   * Parse a CSV file into an array of records.
   */
  static parseCsv(content: string): Record<string, string>[] {
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    const records: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = values[index] ?? '';
      });
      records.push(record);
    }
    return records;
  }

  /**
   * Parse a simple YAML file (key-value structure).
   */
  static parseYaml(content: string): Record<string, any> {
    const lines = content.split(/\r?\n/);
    const result: Record<string, any> = {};
    for (const line of lines) {
      if (line.trim().startsWith('#') || !line.includes(':')) continue;
      const [key, ...valParts] = line.split(':');
      const val = valParts.join(':').trim();
      result[key.trim()] = val.replace(/^['"]|['"]$/g, ''); // strip quotes
    }
    return result;
  }

  /**
   * Parse a simple XML file into key-value pairs.
   */
  static parseXml(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    const regex = /<([^>]+)>([^<]*)<\/\1>/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      result[match[1]] = match[2].trim();
    }
    return result;
  }

  // ==========================================
  // 2. File Validations (PDF, Excel, ZIP)
  // ==========================================

  /**
   * Verify if a file is a valid PDF.
   */
  static validatePdf(filePath: string): boolean {
    try {
      this.logger.info(`Validating PDF: ${filePath}`);
      const buffer = readFileSync(filePath);
      // PDF files always start with %PDF
      const header = buffer.toString('utf-8', 0, 4);
      return header === '%PDF';
    } catch (err) {
      this.logger.error(`PDF validation failed for ${filePath}`, { error: err });
      return false;
    }
  }

  /**
   * Verify if a file is a valid Excel (.xlsx) file.
   */
  static validateExcel(filePath: string): boolean {
    try {
      this.logger.info(`Validating Excel: ${filePath}`);
      const buffer = readFileSync(filePath);
      // Modern Excel (.xlsx) files are ZIP archives, starting with PK\x03\x04
      const header = buffer.toString('hex', 0, 4);
      return header === '504b0304'; // hex for PK\x03\x04
    } catch (err) {
      this.logger.error(`Excel validation failed for ${filePath}`, { error: err });
      return false;
    }
  }

  /**
   * Verify if a file is a valid ZIP archive.
   */
  static validateZip(filePath: string): boolean {
    try {
      this.logger.info(`Validating ZIP: ${filePath}`);
      const buffer = readFileSync(filePath);
      const header = buffer.toString('hex', 0, 4);
      return header === '504b0304'; // hex for PK\x03\x04
    } catch (err) {
      this.logger.error(`ZIP validation failed for ${filePath}`, { error: err });
      return false;
    }
  }

  // ==========================================
  // 3. Random Data Generation
  // ==========================================

  /**
   * Generate a random string of a given length.
   */
  static generateRandomString(length = 8): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Generate a random email address.
   */
  static generateRandomEmail(prefix = 'test'): string {
    return `${prefix}_${Date.now()}@example.com`;
  }

  /**
   * Generate a random 10-digit phone number.
   */
  static generateRandomPhone(): string {
    let phone = '703';
    for (let i = 0; i < 7; i++) {
      phone += Math.floor(Math.random() * 10);
    }
    return phone;
  }

  // ==========================================
  // 4. Lightweight Embedded Mock Database
  // ==========================================

  static mockDbQuery(query: string, params?: any[]): any {
    const dbFile = 'storage/mock-database.json';
    this.logger.info(`Mock Database: Executing query "${query}"`);
    
    if (!pathExistsSync(dbFile)) {
      writeJsonSync(dbFile, {
        users: [
          { id: 1, name: 'Guna Sekhar', email: 'guna@gmail.com', role: 'admin' },
          { id: 2, name: 'John Anderson', email: 'john.anderson@venusenergy.com', role: 'user' }
        ],
        companies: [
          { id: 101, name: 'Venus Energy Solutions LLC', country: 'United States' }
        ]
      });
    }

    const db = readJsonSync(dbFile);

    if (query.toLowerCase().startsWith('select * from users')) {
      return db.users;
    }
    if (query.toLowerCase().startsWith('select * from companies')) {
      return db.companies;
    }
    if (query.toLowerCase().startsWith('insert into users')) {
      if (params && params.length >= 2) {
        const newUser = { id: db.users.length + 1, name: params[0], email: params[1], role: params[2] ?? 'user' };
        db.users.push(newUser);
        writeJsonSync(dbFile, db);
        return newUser;
      }
    }
    return null;
  }
}
