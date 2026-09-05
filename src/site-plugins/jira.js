export default {
  name: 'jira',
  matches: (url) => (url.hostname === 'atlassian.net' || url.hostname.endsWith('.atlassian.net'))
    && url.pathname.startsWith('/browse/'),
  apply: (bookmark, url) => {
    const issueKey = url.pathname.match(/^\/browse\/([A-Z][A-Z0-9]+-\d+)/i)?.[1];
    return {
      ...bookmark,
      site: 'jira',
      type: 'issue',
      contexts: bookmark.contexts?.length ? bookmark.contexts : ['work'],
      issue_key: bookmark.issue_key || issueKey,
      project_key: bookmark.project_key || issueKey?.split('-')[0],
      tags: [...new Set([...(bookmark.tags || []), 'jira'])]
    };
  }
};
