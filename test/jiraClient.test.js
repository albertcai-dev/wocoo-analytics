import { describe, it, expect } from 'vitest';
import { buildDayJql, parseToolResult, createJiraClient } from '../src/jiraClient.js';

describe('buildDayJql', () => {
  const jql = buildDayJql('2026-08-03');

  it('bounds the day half-open, from the date to the next date', () => {
    expect(jql).toContain('statusCategoryChangedDate >= "2026-08-03"');
    expect(jql).toContain('statusCategoryChangedDate < "2026-08-04"');
  });

  it('restricts to the done status category', () => {
    expect(jql).toContain('statusCategory = Done');
  });

  // Load-bearing: automation tickets are visible under statusCategoryChangedDate
  // and are assigned to roster members. Without this they inflate counts ~5/day.
  it('excludes the Workato automation tickets', () => {
    expect(jql).toContain('summary !~ "Eligibility Confirmation Request"');
  });

  it('scopes to WOCOO', () => {
    expect(jql).toContain('project = WOCOO');
  });
});

describe('parseToolResult', () => {
  it('unwraps the MCP content envelope', () => {
    const result = { content: [{ type: 'text', text: '{"issues":[]}' }] };
    expect(parseToolResult(result)).toEqual({ issues: [] });
  });

  it('ignores non-text parts', () => {
    const result = {
      content: [{ type: 'image', data: 'x' }, { type: 'text', text: '{"issues":[1]}' }],
    };
    expect(parseToolResult(result).issues).toEqual([1]);
  });

  it('throws when there is no text part', () => {
    expect(() => parseToolResult({ content: [] })).toThrow(/no text/i);
  });
});

describe('createJiraClient', () => {
  const issue = (assignee, issue_type, status) => ({ assignee, issue_type, status });
  const wrap = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });

  it('maps issues to rows', async () => {
    const tools = {
      call: async () => wrap({ issues: [issue('Albert Cai', 'Wires Posting', 'Done')] }),
    };
    const rows = await createJiraClient(tools).fetchDay('2026-08-03');
    expect(rows).toEqual([
      { assignee: 'Albert Cai', workType: 'Wires Posting', outcome: 'done' },
    ]);
  });

  it('marks cancelled rows', async () => {
    const tools = {
      call: async () => wrap({ issues: [issue('Albert Cai', 'X', 'Cancelled/ No Action')] }),
    };
    const rows = await createJiraClient(tools).fetchDay('2026-08-03');
    expect(rows[0].outcome).toBe('cancelled');
  });

  it('follows next_page_token until exhausted', async () => {
    const pages = [
      wrap({ issues: [issue('A', 'T', 'Done')], next_page_token: 'p2' }),
      wrap({ issues: [issue('B', 'T', 'Done')], next_page_token: 'p3' }),
      wrap({ issues: [issue('C', 'T', 'Done')] }),
    ];
    let i = 0;
    const seen = [];
    const tools = {
      call: async (_name, args) => { seen.push(args.next_page_token); return pages[i++]; },
    };
    const rows = await createJiraClient(tools).fetchDay('2026-08-03');
    expect(rows).toHaveLength(3);
    expect(seen).toEqual([undefined, 'p2', 'p3']);
  });

  it('requests only the three fields it needs', async () => {
    let captured;
    const tools = {
      call: async (_name, args) => { captured = args; return wrap({ issues: [] }); },
    };
    await createJiraClient(tools).fetchDay('2026-08-03');
    expect(captured.fields).toBe('assignee,status,issuetype');
    expect(captured.max_results).toBe(100);
  });

  it('treats a missing assignee as null rather than a string', async () => {
    const tools = {
      call: async () => wrap({ issues: [{ issue_type: 'T', status: 'Done' }] }),
    };
    const rows = await createJiraClient(tools).fetchDay('2026-08-03');
    expect(rows[0].assignee).toBeNull();
  });

  it('stops after the page cap so a pagination bug cannot loop forever', async () => {
    const tools = {
      call: async () => wrap({ issues: [issue('A', 'T', 'Done')], next_page_token: 'always' }),
    };
    await expect(createJiraClient(tools).fetchDay('2026-08-03')).rejects.toThrow(/too many pages/i);
  });
});
