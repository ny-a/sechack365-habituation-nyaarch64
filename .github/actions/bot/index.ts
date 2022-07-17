import { Octokit } from "@octokit/rest";
import fs from 'fs';
import * as process from 'process';

const GH_TOKEN = process.env.GH_TOKEN;
const dryRun = process.env.DRY_RUN === 'true';

const repository = process.env.REPOSITORY;
const userName = process.env.ASSIGN_USER || undefined;
const diaryLabel = process.env.ISSUE_LABEL || undefined;
const issueTemplate = process.env.ISSUE_TEMPLATE || undefined;
const typetalkTopicId = process.env.TYPETALK_TOPIC_ID;
const typetalkToken = process.env.TYPETALK_TOKEN;
const targetDayOffsetString = process.env.TARGET_DAY_OFFSET;

if (!repository) {
  console.error('REPOSITORY environment variable is not set.');
  process.exit(1);
}
if (!typetalkTopicId) {
  console.error('TYPETALK_TOPIC_ID environment variable is not set.');
  process.exit(1);
}
if (!typetalkToken) {
  console.error('TYPETALK_TOKEN environment variable is not set.');
  process.exit(1);
}

const issueTemplateContent = issueTemplate !== undefined && fs.existsSync(issueTemplate) && fs.readFileSync(issueTemplate, { encoding: 'utf-8' }) || '';

const targetDayOffset = parseInt(targetDayOffsetString || '') || 0;

const [repoOwner, repoName] = repository.split('/')

const octokit = new Octokit({
  auth: GH_TOKEN,
  userAgent: 'ny-a/sechack365-habituation',
});

(async () => {
  const now = new Date();
  now.setHours(now.getHours() + 9); // convert ISOString (UTC) to JST
  const issueList = await octokit.paginate(octokit.issues.listForRepo, {
    owner: repoOwner,
    repo: repoName,
    labels: diaryLabel,
  })

  issueList.forEach(async (issue) => {
    console.log(issue.title);
    const issueComments = (await octokit.paginate(octokit.issues.listComments, {
      owner: repoOwner,
      repo: repoName,
      issue_number: issue.number,
    }));

    const comments = issueComments
      .map((comment) => {
        const user = comment.user && comment.user.login !== userName ? ` (@${comment.user?.login})` : '';
        return `${dateStringToLocalTime(comment.created_at)}${user} ${comment.body}`;
      })
      .join('\n');

    const issueBody = (issue.body || '')
      .replace(/^- \[ \]/gm, '- :large_green_square:')
      .replace(/^- \[x\]/gm, '- :white_check_mark:');

    const body = `${issue.title}\n${issueBody}\nコメント:\n${comments}\n`;

    // @ts-ignore(TS2304)
    await fetch(
      `https://typetalk.com/api/v1/topics/${typetalkTopicId}`,
      {
        headers: {
          'X-TYPETALK-TOKEN': typetalkToken,
          'Content-Type': 'application/json'
        },
        method: 'post',
        body: JSON.stringify({ message: body })
      }
    )

    if (!dryRun) {
      const issueCloseResult = await octokit.issues.update({
        owner: repoOwner,
        repo: repoName,
        issue_number: issue.number,
        state: 'closed',
      })
      if (issueCloseResult.status !== 200) {
        console.log('issueCloseResult error', issueCloseResult.status)
        return;
      }
    }
  });

  const targetDay = new Date(now.getTime());
  targetDay.setDate(targetDay.getDate() + targetDayOffset);

  if (!dryRun) {
    const labels = diaryLabel !== undefined ? [diaryLabel] : [];
    const assignees = userName !== undefined ? [userName] : [];

    const issueOpenResult = await octokit.issues.create({
      owner: repoOwner,
      repo: repoName,
      title: targetDay.toISOString().slice(0, 10),
      body: issueTemplateContent,
      labels,
      assignees,
    })
    if (issueOpenResult.status !== 201) {
      console.log('issueOpenResult error', issueOpenResult.status)
      return;
    }
  }
})();

const dateStringToLocalTime = (s: string) => {
  const date = new Date(s);
  date.setHours(date.getHours() + 9);
  return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}:${date.getUTCSeconds().toString().padStart(2, '0')}`
}

