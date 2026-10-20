import { describe, expect, it } from 'vitest';
import { formatReportEntry, REPORT_LIMIT, type ReportEntry, reportSections } from './report.ts';

const entry = (text: string): ReportEntry => ({
  kind: 'dissolved_pair',
  reason: 'command',
  match: 'single',
  query: '/inventario',
  type: 'drop',
  text,
});

describe('report', () => {
  it('formatReportEntry_prints_the_kind_and_its_fields_as_json_values', () => {
    expect(formatReportEntry(entry('l\'a "b" x\\y\n'))).toBe(
      'dissolved_pair: reason="command" match="single" query="/inventario" type="drop" text="l\'a \\"b\\" x\\\\y\\n"'
    );
  });

  it('reportSections_count_each_kind_and_show_its_first_entries', () => {
    const many = Array.from({ length: REPORT_LIMIT + 2 }, (_, i) => entry(`r${i}`));
    const lines = reportSections(many);
    expect(lines[0]).toBe(`-- dissolved_pair: ${REPORT_LIMIT + 2} (primi ${REPORT_LIMIT})`);
    expect(lines).toHaveLength(REPORT_LIMIT + 1);
    expect(reportSections([entry('x')])[0]).toBe('-- dissolved_pair: 1');
    expect(reportSections([])).toStrictEqual([]);
  });
});
