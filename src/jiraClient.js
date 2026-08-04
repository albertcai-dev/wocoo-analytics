import { nextDate } from './dates.js';

const FIELDS = 'assignee,status,issuetype';
const PAGE_SIZE = 100;          // jira_search_tickets caps max_results at 100
const MAX_PAGES = 50;           // 5,000 tickets in one day is impossible; a hit means a bug

/**
 * One calendar day, half-open [date, nextDate).
 *
 * Bare YYYY-MM-DD bounds are interpreted in the viewer's own Jira timezone, so Jira
 * does the bucketing and there is no client-side date maths to get wrong.
 *
 * The summary exclusion is load-bearing, not defensive: Workato's "Eligibility
 * Confirmation Request" tickets are created and closed within seconds, are assigned
 * to roster members, and DO carry a status-category change date.
 */
export function buildDayJql(date) {
  return [
    'project = WOCOO',
    'statusCategory = Done',
    `statusCategoryChangedDate >= "${date}"`,
    `statusCategoryChangedDate < "${nextDate(date)}"`,
    'summary !~ "Eligibility Confirmation Request"',
  ].join(' AND ');
}

/** MagicTools returns a standard MCP result: { content: [{type, text}] }. */
export function parseToolResult(result) {
  const part = (result?.content || []).find((p) => p.type === 'text');
  if (!part) throw new Error('MagicTools returned no text part');
  return JSON.parse(part.text);
}

function toRow(issue) {
  return {
    assignee: issue.assignee ? String(issue.assignee) : null,
    workType: issue.issue_type || 'Unknown',
    outcome: (issue.status || '').trim() === 'Cancelled/ No Action' ? 'cancelled' : 'done',
  };
}

/** `tools` is window.MagicTools, or anything with the same .call(name, args) shape. */
export function createJiraClient(tools) {
  async function fetchDay(date) {
    const jql = buildDayJql(date);
    const rows = [];
    let token;

    for (let page = 0; page < MAX_PAGES; page++) {
      const args = { jql, fields: FIELDS, max_results: PAGE_SIZE };
      if (token) args.next_page_token = token;

      const payload = parseToolResult(await tools.call('jira_search_tickets', args));
      for (const issue of payload.issues || []) rows.push(toRow(issue));

      token = payload.next_page_token;
      if (!token) return rows;
    }
    throw new Error(`too many pages for ${date} — pagination is not terminating`);
  }

  return { fetchDay };
}
