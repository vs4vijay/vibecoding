#!/usr/bin/env bun

import { Octokit } from "@octokit/rest";
import { simpleGit } from "simple-git";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { $ } from "bun";

// ============================================================================
// Types
// ============================================================================

interface Config {
  githubToken: string;
  owner: string;
  repo: string;
  issueLabel: string;
  minReactions: number;
  minIssueAgeHours: number;
  workspacePath: string;
  timeoutMinutes: number;
  cronIntervalMinutes: number;
}

interface Issue {
  number: number;
  title: string;
  body: string | null;
  user: { login: string } | null;
  created_at: string;
  reactions: {
    "+1": number;
  };
}

interface ExecutionResult {
  success: boolean;
  message: string;
  prNumber?: number;
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

function loadConfig(): Config {
  const token = process.env.GITHUB_TOKEN || Bun.env.GITHUB_TOKEN;
  if (!token) {
    console.error("❌ GITHUB_TOKEN environment variable is required");
    process.exit(1);
  }

  return {
    githubToken: token,
    owner: process.env.GITHUB_OWNER || Bun.env.GITHUB_OWNER || "vs4vijay",
    repo: process.env.GITHUB_REPO || Bun.env.GITHUB_REPO || "CrowdCode",
    issueLabel: process.env.ISSUE_LABEL || Bun.env.ISSUE_LABEL || "crowdcode",
    minReactions: parseInt(process.env.MIN_REACTIONS || Bun.env.MIN_REACTIONS || "1"),
    minIssueAgeHours: parseInt(process.env.MIN_ISSUE_AGE_HOURS || Bun.env.MIN_ISSUE_AGE_HOURS || "24"),
    workspacePath: process.env.WORKSPACE_PATH || Bun.env.WORKSPACE_PATH || "./workspace",
    timeoutMinutes: parseInt(process.env.TIMEOUT_MINUTES || Bun.env.TIMEOUT_MINUTES || "30"),
    cronIntervalMinutes: parseInt(process.env.CRON_INTERVAL_MINUTES || Bun.env.CRON_INTERVAL_MINUTES || "1440"),
  };
}

const config = loadConfig();
const octokit = new Octokit({ auth: config.githubToken });

// ============================================================================
// Issue Selection
// ============================================================================

async function fetchTopIssue(): Promise<Issue | null> {
  console.log(`🔍 Fetching issues with label "${config.issueLabel}"...`);

  // Fetch open issues with the specified label
  const { data: issues } = await octokit.issues.listForRepo({
    owner: config.owner,
    repo: config.repo,
    labels: config.issueLabel,
    state: "open",
    per_page: 100,
  });

  if (issues.length === 0) {
    console.log(`ℹ️  No issues found with label "${config.issueLabel}"`);
    return null;
  }

  console.log(`📋 Found ${issues.length} issue(s) with label "${config.issueLabel}"`);

  // Fetch reactions for each issue and filter by age
  const issuesWithReactions: Issue[] = [];
  const now = new Date();
  const minAgeMs = config.minIssueAgeHours * 60 * 60 * 1000;

  for (const issue of issues) {
    const issueAge = now.getTime() - new Date(issue.created_at).getTime();

    if (issueAge < minAgeMs) {
      console.log(`⏳ Skipping issue #${issue.number}: too new (${Math.round(issueAge / 3600000)}h old, need ${config.minIssueAgeHours}h)`);
      continue;
    }

    const { data: reactions } = await octokit.reactions.listForIssue({
      owner: config.owner,
      repo: config.repo,
      issue_number: issue.number,
    });

    const thumbsUp = reactions.filter((r) => r.content === "+1").length;

    if (thumbsUp >= config.minReactions) {
      issuesWithReactions.push({
        number: issue.number,
        title: issue.title,
        body: issue.body,
        user: issue.user,
        created_at: issue.created_at,
        reactions: {
          "+1": thumbsUp,
        },
      });
    }
  }

  if (issuesWithReactions.length === 0) {
    console.log(`ℹ️  No issues meet the criteria (min ${config.minReactions} 👍, ${config.minIssueAgeHours}h old)`);
    return null;
  }

  // Sort by reactions (descending)
  issuesWithReactions.sort((a, b) => b.reactions["+1"] - a.reactions["+1"]);

  const topIssue = issuesWithReactions[0];
  console.log(`\n🏆 Top issue: #${topIssue.number} with ${topIssue.reactions["+1"]} 👍`);
  console.log(`   Title: ${topIssue.title}`);
  console.log(`   Author: @${topIssue.user?.login || "unknown"}`);

  return topIssue;
}

async function fetchIssueById(issueNumber: number): Promise<Issue | null> {
  console.log(`🔍 Fetching issue #${issueNumber}...`);

  try {
    const { data: issue } = await octokit.issues.get({
      owner: config.owner,
      repo: config.repo,
      issue_number: issueNumber,
    });

    const { data: reactions } = await octokit.reactions.listForIssue({
      owner: config.owner,
      repo: config.repo,
      issue_number: issueNumber,
    });

    const thumbsUp = reactions.filter((r) => r.content === "+1").length;

    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      user: issue.user,
      created_at: issue.created_at,
      reactions: {
        "+1": thumbsUp,
      },
    };
  } catch (error) {
    console.error(`❌ Failed to fetch issue #${issueNumber}:`, error);
    return null;
  }
}

// ============================================================================
// Abuse Detection
// ============================================================================

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+[\/~]/i,
  /:\(\)\{\s*:\|:&\s*\};:/,  // fork bomb
  /(curl|wget)\s+.*\|\s*(bash|sh)/i,
  /\/dev\/(sda|nvme)/i,
  /chmod\s+777/i,
  /(sudo|su)\s+/i,
  /\.env|\.aws|\.ssh/i,
  /eval\s*\(/i,
  /while\s*\(\s*true\s*\)/i,
  /crypto.*mining/i,
];

function detectAbuse(text: string): { risky: boolean; reason?: string } {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(text)) {
      return {
        risky: true,
        reason: `Detected potentially dangerous pattern: ${pattern.source}`,
      };
    }
  }
  return { risky: false };
}

// ============================================================================
// GitHub Utilities
// ============================================================================

async function postComment(issueNumber: number, body: string): Promise<void> {
  await octokit.issues.createComment({
    owner: config.owner,
    repo: config.repo,
    issue_number: issueNumber,
    body,
  });
}

async function createPullRequest(
  branchName: string,
  issueNumber: number,
  issueTitle: string
): Promise<number> {
  const { data: pr } = await octokit.pulls.create({
    owner: config.owner,
    repo: config.repo,
    title: `Implement: ${issueTitle}`,
    head: branchName,
    base: "main",
    body: `Fixes #${issueNumber}\n\n🤖 This PR was automatically generated by CrowdCode.\n\n## Implementation\n\nAutomated implementation of the feature request described in issue #${issueNumber}.`,
  });

  // Add labels
  await octokit.issues.addLabels({
    owner: config.owner,
    repo: config.repo,
    issue_number: pr.number,
    labels: ["crowdcode", "auto-generated"],
  });

  return pr.number;
}

async function createTrackingIssue(): Promise<void> {
  const now = new Date().toISOString();
  await octokit.issues.create({
    owner: config.owner,
    repo: config.repo,
    title: `[CrowdCode] No eligible issues for ${new Date().toDateString()}`,
    body: `🤖 **CrowdCode Automated Report**\n\n**Date**: ${now}\n\n**Status**: No eligible issues found\n\n**Criteria**:\n- Label: \`${config.issueLabel}\`\n- Minimum reactions: ${config.minReactions} 👍\n- Minimum age: ${config.minIssueAgeHours} hours\n\n**Action**: No implementation performed today.\n\n---\n\nTo submit an issue for CrowdCode:\n1. Create an issue with clear requirements\n2. Add the \`${config.issueLabel}\` label\n3. Wait ${config.minIssueAgeHours} hours\n4. Get community votes (👍 reactions)`,
    labels: ["crowdcode", "status-report"],
  });
  console.log("📝 Created tracking issue for no eligible issues");
}

// ============================================================================
// Claude Code Execution
// ============================================================================

async function executeImplementation(issue: Issue): Promise<ExecutionResult> {
  // Create a one-liner slug from issue title
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

  const workspaceDir = join(config.workspacePath, `issue-${issue.number}-${slug}-${Date.now()}`);
  const branchName = `crowdcode/issue-${issue.number}`;

  try {
    // Check for abuse
    console.log("\n🛡️  Running abuse detection...");
    const abuseCheck = detectAbuse(issue.body || "");
    if (abuseCheck.risky) {
      console.error(`❌ Abuse detected: ${abuseCheck.reason}`);
      await postComment(
        issue.number,
        `❌ **Implementation Rejected**\n\nThis issue was flagged by our security system:\n\n> ${abuseCheck.reason}\n\nPlease revise the issue description and remove any potentially dangerous requests.`
      );
      return {
        success: false,
        message: "Abuse detected",
        error: abuseCheck.reason,
      };
    }

    // Post starting comment
    console.log("\n💬 Posting start comment...");
    await postComment(
      issue.number,
      `🤖 **Implementation Started**\n\nI've selected this issue for implementation!\n\n⏳ **Status**: Starting implementation...\n\n*This may take up to ${config.timeoutMinutes} minutes.*`
    );

    // Create workspace
    console.log(`\n📁 Creating workspace: ${workspaceDir}`);
    if (existsSync(workspaceDir)) {
      rmSync(workspaceDir, { recursive: true });
    }
    mkdirSync(workspaceDir, { recursive: true });

    // Clone repository
    console.log(`\n📥 Cloning repository...`);
    const git = simpleGit();
    await git.clone(
      `https://${config.githubToken}@github.com/${config.owner}/${config.repo}.git`,
      workspaceDir
    );

    // Create branch
    const repoGit = simpleGit(workspaceDir);
    console.log(`\n🌿 Creating branch: ${branchName}`);
    await repoGit.checkoutLocalBranch(branchName);

    // Build Claude Code prompt
    const prompt = `Implement this feature request for the repository:

Repository: ${config.owner}/${config.repo}
Issue #${issue.number}: ${issue.title}

Description:
${issue.body || "No description provided"}

IMPORTANT:
- Create new files as needed (the repository may be mostly empty)
- Implement a complete, working solution
- Add any necessary dependencies or configuration files
- Follow best practices for the language/framework you choose
- Make sure to actually write the code - don't just plan or describe it

Please proceed with the implementation now.`;

    // Execute Claude Code CLI with real-time output
    console.log("\n🤖 Executing Claude Code CLI (streaming output)...");
    console.log(`⏱️  Timeout: ${config.timeoutMinutes} minutes`);
    console.log("─".repeat(60));

    const claudeProcess = Bun.spawn([
        "agency", 
        "claude", "--allowedTools", "Edit,Write",
         "--print", prompt], {
      cwd: workspaceDir,
      stdout: "inherit", // Stream directly to console
      stderr: "inherit", // Stream directly to console
    });

    // Set timeout
    const timeoutMs = config.timeoutMinutes * 60 * 1000;
    const timeout = setTimeout(() => {
      claudeProcess.kill();
      console.error(`\n⏱️  Execution timeout after ${config.timeoutMinutes} minutes`);
    }, timeoutMs);

    const exitCode = await claudeProcess.exited;
    clearTimeout(timeout);

    console.log("─".repeat(60));

    if (exitCode !== 0) {
      throw new Error(`Claude Code CLI failed with exit code ${exitCode}`);
    }

    console.log("\n✅ Claude Code execution completed");

    // List all files in workspace to see what was created
    console.log("\n📂 Listing workspace contents...");
    try {
      const lsResult = await $`ls -la ${workspaceDir}`.text();
      console.log(lsResult);
    } catch (e) {
      console.log("(Could not list files)");
    }

    // Check for changes (including untracked files)
    console.log("\n🔍 Checking git status...");
    const status = await repoGit.status();

    console.log(`📊 Git status: ${status.files.length} file(s) changed`);
    if (status.files.length > 0) {
      console.log("Files:", status.files.map(f => `${f.path} (${f.working_dir})`).join(", "));
    }

    // Also check for untracked files explicitly
    const untrackedFiles = status.not_added;
    if (untrackedFiles.length > 0) {
      console.log(`📝 Untracked files: ${untrackedFiles.length}`);
      console.log("Untracked:", untrackedFiles.join(", "));
    }

    const hasChanges = status.files.length > 0 || untrackedFiles.length > 0;

    if (!hasChanges) {
      console.log("\nℹ️  No changes made by Claude Code");
      console.log("💡 This might mean:");
      console.log("   - Files were created outside the git repository");
      console.log("   - Claude Code didn't actually write files");
      console.log("   - Files are in .gitignore");
      console.log(`\n📁 Workspace preserved at: ${workspaceDir}`);

      await postComment(
        issue.number,
        `ℹ️  **No Changes Needed**\n\nAfter analyzing the issue, no code changes were required. The issue may already be resolved or require clarification.\n\n*Workspace preserved for debugging: \`${workspaceDir}\`*`
      );
      return {
        success: true,
        message: "No changes needed",
      };
    }

    // Commit changes
    console.log(`\n💾 Committing changes (${status.files.length} file(s))...`);
    await repoGit.add(".");
    await repoGit.commit(`Implement issue #${issue.number}: ${issue.title}

${issue.body || ""}

Generated by CrowdCode
Issue: #${issue.number}

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>`);

    // Push changes
    console.log("\n📤 Pushing to remote...");
    await repoGit.push("origin", branchName, ["--set-upstream"]);

    // Create PR
    console.log("\n🔀 Creating pull request...");
    const prNumber = await createPullRequest(branchName, issue.number, issue.title);

    // Post success comment
    await postComment(
      issue.number,
      `✅ **Implementation Complete!**\n\n🔀 Pull Request: #${prNumber}\n\nPlease review the changes and merge if everything looks good.`
    );

    console.log(`\n✅ Success! PR #${prNumber} created`);

    return {
      success: true,
      message: "Implementation completed",
      prNumber,
    };
  } catch (error) {
    console.error("\n❌ Error during execution:", error);

    // Post error comment
    await postComment(
      issue.number,
      `❌ **Implementation Failed**\n\nAn error occurred during implementation:\n\n\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\`\n\nPlease check the issue description and try again.`
    );

    return {
      success: false,
      message: "Implementation failed",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Keep workspace for debugging (cleanup disabled)
    if (existsSync(workspaceDir)) {
      console.log(`\n📁 Workspace preserved at: ${workspaceDir}`);
      console.log(`💡 To clean up manually: rm -rf "${workspaceDir}"`);
    }
    // Uncomment below to enable automatic cleanup:
    // rmSync(workspaceDir, { recursive: true });
  }
}

// ============================================================================
// Main Execution Modes
// ============================================================================

async function runOnce(): Promise<void> {
  console.log("🚀 CrowdCode - Single Run Mode\n");

  const topIssue = await fetchTopIssue();

  if (!topIssue) {
    await createTrackingIssue();
    console.log("\n✨ Done - no eligible issues");
    return;
  }

  await executeImplementation(topIssue);
  console.log("\n✨ Done");
}

async function runWithIssueId(issueNumber: number): Promise<void> {
  console.log(`🚀 CrowdCode - Specific Issue Mode (#${issueNumber})\n`);

  const issue = await fetchIssueById(issueNumber);

  if (!issue) {
    console.error(`❌ Issue #${issueNumber} not found or inaccessible`);
    return;
  }

  await executeImplementation(issue);
  console.log("\n✨ Done");
}

async function runWithTask(taskDescription: string): Promise<void> {
  console.log(`🚀 CrowdCode - Custom Task Mode\n`);

  const fakeIssue: Issue = {
    number: 0,
    title: "Custom Task",
    body: taskDescription,
    user: null,
    created_at: new Date().toISOString(),
    reactions: { "+1": 0 },
  };

  // Create a temporary issue for tracking
  const { data: issue } = await octokit.issues.create({
    owner: config.owner,
    repo: config.repo,
    title: `[CrowdCode Task] ${taskDescription.slice(0, 50)}${taskDescription.length > 50 ? "..." : ""}`,
    body: `🤖 **Custom CrowdCode Task**\n\n${taskDescription}\n\n*This issue was automatically created for a custom task execution.*`,
    labels: ["crowdcode", "custom-task"],
  });

  console.log(`📝 Created tracking issue #${issue.number}`);

  fakeIssue.number = issue.number;

  await executeImplementation(fakeIssue);
  console.log("\n✨ Done");
}

async function runCronDaemon(intervalMinutes: number): Promise<void> {
  console.log(`🚀 CrowdCode - Cron Daemon Mode`);
  console.log(`⏰ Running every ${intervalMinutes} minutes\n`);

  const runInterval = async () => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`⏰ [${new Date().toISOString()}] Starting scheduled run...`);
    console.log("=".repeat(60) + "\n");

    try {
      const topIssue = await fetchTopIssue();

      if (!topIssue) {
        await createTrackingIssue();
        console.log("\n✨ Completed - no eligible issues");
      } else {
        await executeImplementation(topIssue);
        console.log("\n✨ Completed successfully");
      }
    } catch (error) {
      console.error("\n❌ Scheduled run failed:", error);
    }

    console.log(`\n⏰ Next run in ${intervalMinutes} minutes...`);
  };

  // Run immediately on start
  await runInterval();

  // Then run on interval
  setInterval(runInterval, intervalMinutes * 60 * 1000);

  // Keep process alive
  console.log("\n✅ Daemon started. Press Ctrl+C to stop.");
}

// ============================================================================
// CLI
// ============================================================================

function printHelp(): void {
  console.log(`
🤖 CrowdCode - Automated Crowdsourced Implementation System

USAGE:
  crowdcode [OPTIONS]

OPTIONS:
  --cron <minutes>        Run in daemon mode, checking for issues every N minutes
                          Example: --cron 60 (check every hour)
                          Default: 1440 (24 hours) if no value specified

  --issue-id <number>     Implement a specific issue by issue number
                          Example: --issue-id 42

  --task <description>    Implement a custom task with the given description
                          Example: --task "Add dark mode support"

  --help                  Show this help message

EXAMPLES:
  # Run once (testing mode)
  crowdcode

  # Run as daemon with default interval (24 hours)
  crowdcode --cron

  # Run as daemon checking every hour
  crowdcode --cron 60

  # Implement specific issue
  crowdcode --issue-id 123

  # Implement custom task
  crowdcode --task "Add authentication to the API"

ENVIRONMENT VARIABLES:
  GITHUB_TOKEN            Required: GitHub personal access token
  GITHUB_OWNER            Repository owner (default: vs4vijay)
  GITHUB_REPO             Repository name (default: CrowdCode)
  ISSUE_LABEL             Issue label to filter (default: crowdcode)
  MIN_REACTIONS           Minimum 👍 reactions (default: 1)
  MIN_ISSUE_AGE_HOURS     Minimum issue age in hours (default: 24)
  WORKSPACE_PATH          Path for temporary workspace (default: ./workspace)
  TIMEOUT_MINUTES         Execution timeout (default: 30)
  CRON_INTERVAL_MINUTES   Default cron interval (default: 1440)

SETUP:
  1. Install Bun: https://bun.sh
  2. Install Claude Code CLI and authenticate
  3. Set GITHUB_TOKEN environment variable
  4. Run: crowdcode

For more information, visit: https://github.com/vs4vijay/CrowdCode
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const cronIndex = args.indexOf("--cron");
  const issueIdIndex = args.indexOf("--issue-id");
  const taskIndex = args.indexOf("--task");

  if (cronIndex !== -1) {
    // Cron mode
    const intervalArg = args[cronIndex + 1];
    const interval = intervalArg && !intervalArg.startsWith("--")
      ? parseInt(intervalArg)
      : config.cronIntervalMinutes;

    if (isNaN(interval) || interval <= 0) {
      console.error("❌ Invalid interval value for --cron");
      process.exit(1);
    }

    await runCronDaemon(interval);
  } else if (issueIdIndex !== -1) {
    // Specific issue mode
    const issueIdArg = args[issueIdIndex + 1];
    if (!issueIdArg) {
      console.error("❌ --issue-id requires an issue number");
      process.exit(1);
    }

    const issueNumber = parseInt(issueIdArg);
    if (isNaN(issueNumber)) {
      console.error("❌ Invalid issue number");
      process.exit(1);
    }

    await runWithIssueId(issueNumber);
  } else if (taskIndex !== -1) {
    // Custom task mode
    const taskDescription = args.slice(taskIndex + 1).join(" ");
    if (!taskDescription) {
      console.error("❌ --task requires a task description");
      process.exit(1);
    }

    await runWithTask(taskDescription);
  } else {
    // Default: run once
    await runOnce();
  }
}

// Run
main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
