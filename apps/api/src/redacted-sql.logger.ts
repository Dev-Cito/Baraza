import { AdvancedConsoleLogger, QueryRunner } from 'typeorm';

// Logs SQL text but never the bound parameters, which can carry password
// hashes, emails and other personal data (e.g. INSERT INTO "user").
export class RedactedSqlLogger extends AdvancedConsoleLogger {
  logQuery(query: string, _parameters?: unknown, queryRunner?: QueryRunner) {
    super.logQuery(query, undefined, queryRunner);
  }

  logQueryError(
    error: string,
    query: string,
    _parameters?: unknown,
    queryRunner?: QueryRunner,
  ) {
    super.logQueryError(error, query, undefined, queryRunner);
  }

  logQuerySlow(
    time: number,
    query: string,
    _parameters?: unknown,
    queryRunner?: QueryRunner,
  ) {
    super.logQuerySlow(time, query, undefined, queryRunner);
  }
}
