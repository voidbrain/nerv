/**
 * Reviewed reader contract of this revision (F-005-T06). The Store and the service lifecycle read these values, and
 * test/upgrade-rehearsal.test.ts binds them to what the reader actually does. A revision that changes schema support
 * changes this file, its migration and those regressions together; the numbers alone never admit an upgrade.
 */
export const UPGRADE_CONTRACT={version:1,readerSchema:6,minimumServiceSchema:5} as const;
