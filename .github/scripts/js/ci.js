//@ts-check
const {
  knownLabels,
  knownSlashCommands,
  labelsSrv,
  knownProviders,
  knownChannels,
  knownCRINames,
  knownKubernetesVersions,
  knownEditions,
  e2eDefaults
} = require('./constants');
const { dumpError } = require('./error');

/**
 * Update a comment in "release" issue or pull request when workflow is started.
 *
 * @param {object} inputs
 * @param {object} inputs.github - A pre-authenticated octokit/rest.js client with pagination plugins.
 * @param {object} inputs.context - An object containing the context of the workflow run.
 * @param {object} inputs.core - A reference to the '@actions/core' package.
 * @param {string} inputs.name - A workflow name.
 * @returns {Promise<*>}
 */
module.exports.updateCommentOnStart = async ({ github, context, core, name }) => {
  const repo_url = context.payload.repository.html_url;
  const run_id = context.runId;
  const comment_ref = context.payload.inputs.pull_request_head_label || context.ref;
  const build_url = `${repo_url}/actions/runs/${run_id}`;

  const comment_id = context.payload.inputs.comment_id;
  const issue_id = context.payload.inputs.issue_id;

  console.log(`
        issue_id: ${issue_id}
        comment_id: ${comment_id}
        build_url: ${build_url}
        context: ${JSON.stringify(context)}
  `);

  // Get existing comment.
  let response = await github.rest.issues.getComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    comment_id: comment_id
  });

  if (response.status != 200) {
    return core.setFailed(`comment is not accessible ${JSON.stringify(response)}`);
  }

  const newBody =
    response.data.body +
    `
  :fast_forward:\u00a0\`${name}\` for \`${comment_ref}\` [started](${build_url}).
`;

  response = await github.rest.issues.updateComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    comment_id: comment_id,
    body: newBody
  });

  if (response.status != 200) {
    return core.setFailed(`comment is not accessible ${JSON.stringify(response)}`);
  }

  console.log(`Issue comment updated: ${response.data.html_url}.`);
};

/**
 * Return a human-readable duration between started_at and now.
 *
 * @param started_at - A Unix timestamp.
 * @returns {string}
 */
const humanDurationFrom = (started_at) => {
  let res = '';

  const start = parseInt(started_at, 10);
  let d = Math.floor(Date.now() / 1000) - start;

  // Seconds
  const s = d % 60;
  res = `${s}s`;

  if (d >= 60) {
    // Minutes
    const m = ((d - s) / 60) % 60;
    res = `${m}m${res}`;

    if (d >= 3600) {
      // Hours
      const h = Math.floor(d / 3600);
      res = `${h}h${res}`;
    }
  }

  return res;
}

const renderJobStatusOneLine = ({status, name, time_elapsed}) => {
  let statusComment = `:white_check_mark:\u00a0\`${name}\` succeeded${time_elapsed||''}`;
  if (status === 'failure') {
    statusComment = `:x:\u00a0\`${name}\` failed${time_elapsed||''}`;
  }
  if (status === 'cancelled') {
    statusComment = `:white_small_square:\u00a0\`${name}\` cancelled`;
  }
  if (status === 'skipped') {
    statusComment = `:white_small_square:\u00a0${name} skipped`;
  }

  return `${statusComment}.<!-- result-for: ${name} -->`;
}

const renderJobStatusSeparate = ({status, name, time_elapsed}) => {
  let statusComment = `:green_circle:\u00a0\`${name}\` succeeded${time_elapsed||''}`;
  if (status === 'failure') {
    statusComment = `:red_circle:\u00a0\`${name}\` failed${time_elapsed||''}`;
  }
  if (status === 'cancelled') {
    statusComment = `:white_circle:\u00a0\`${name}\` cancelled`;
  }

  return `\n${statusComment}.<!-- result-for: ${name} -->\n`;
}

const renderWorkflowStatusFinal = ({status, name, ref, build_url, time_elapsed}) => {
  let statusComment = `:green_circle:\u00a0\`${name}\` for \`${ref}\` [succeeded](${build_url})${time_elapsed||''}.`;
  if (status === 'failure') {
    statusComment = `:red_circle:\u00a0\`${name}\` for \`${ref}\` [failed](${build_url})${time_elapsed||''}.`;
  }
  if (status === 'cancelled') {
    statusComment = `:white_circle:\u00a0\`${name}\` for \`${ref}\` [cancelled](${build_url}).`;
  }
  if (status === 'skipped') {
    statusComment = `:white_circle:\u00a0\`${name}\` for \`${ref}\` [skipped](${build_url}).`;
  }

  return statusComment;
}

/**
 * Update a comment in "release" issue or pull request with status of the job or the workflow.
 *
 * statusConfig values:
 * "job" - get status from job context
 * "workflow" - calculate workflow status from needs context
 * "one-line" - Report job status as one line to form one huge multiline.
 * "separate" - Report job statuses on separate lines.
 * "no-skipped" - do not report skipped and cancelled jobs
 * "final" - restore statuses from needs context, wrap comment with details and add summary status for the workflow.
 * "restore-separate" - restore job statuses as separate lines
 * "restore-one-line" - restore job statuses as one-line.
 *
 * Examples:
 * "job,inline" updates comment with job status and a name without extra newlines.
 * "job" updates comment with job status and a name with extra newlines.
 * "workflow,final,no-skipped" add statuses of all jobs without skipped and canceled.
 *
 * @param {object} inputs
 * @param {object} inputs.github - A pre-authenticated octokit/rest.js client with pagination plugins.
 * @param {object} inputs.context - An object containing the context of the workflow run.
 * @param {object} inputs.core - A reference to the '@actions/core' package.
 * @param {string} inputs.statusConfig - A comma-separated combination of 'job', 'workflow', 'one-line', 'separate', 'no-skipped' and 'final'.
 * @param {string} inputs.name - A name to use in the comment.
 * @param {object} inputs.needsContext - The needs context contains outputs from all jobs that are defined as a dependency of the current job.
 * @param {object} inputs.jobContext - The job context contains information about the currently running job.
 * @param {object} inputs.stepsContext - The steps context contains information about previously executed steps.
 * @returns {Promise<*>}
 */
module.exports.updateCommentOnFinish = async ({ github, context, core, statusConfig, name, needsContext, jobContext, stepsContext }) => {
  const repo_url = context.payload.repository.html_url;
  const run_id = context.runId;
  const build_url = `${repo_url}/actions/runs/${run_id}`;
  const ref = context.payload.inputs.pull_request_head_label || context.ref;

  // Get elapsed time
  let time_elapsed = null;
  let startedAt = null;
  if (statusConfig.includes('job') && stepsContext['started_at'] && stepsContext['started_at'].outputs['started_at']) {
    // Calculate workflow elapsed time using 'started_at' step.
    startedAt = stepsContext['started_at'].outputs['started_at'];
  }
  if (statusConfig.includes('workflow') && needsContext['started_at'] && needsContext['started_at'].outputs['started_at']) {
    // Calculate workflow elapsed time using 'started_at' job.
    startedAt = needsContext['started_at'].outputs['started_at'];
  }
  if (startedAt) {
    time_elapsed = ` in ${humanDurationFrom(startedAt)}`
  }
  core.info(`time_elapsed is '${time_elapsed}'`);


  // Get comment
  const comment_id = context.payload.inputs.comment_id;
  const response = await github.rest.issues.getComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    comment_id: comment_id
  });
  core.debug(`rest.issues.getComment response: ${JSON.stringify(response)}`);
  if (response.status !== 200) {
    return core.setFailed(`comment is not accessible ${JSON.stringify(response)}`);
  }
  let comment = response.data.body;

  // A string to append to comment.
  let statusReport = '';
  // Statuses of non-reported jobs.
  let nonReportedJobs = '';
  // Failed jobs count.
  let failedInfo = '';


  // Add a status for one job to the comment.
  if (statusConfig.includes('job')) {
    const status = jobContext.status;
    core.info(`Status for job report is ${status}`);

    if (statusConfig.includes(',one-line')) {
      statusReport = renderJobStatusOneLine({ status, name, time_elapsed });
    } else if (statusConfig.includes(',separate')) {
      statusReport = renderJobStatusSeparate({status, name, time_elapsed});
    } else if (statusConfig.includes(',final')) {
      statusReport = renderWorkflowStatusFinal({ status, name, ref, build_url, time_elapsed });
    }

    // Set job to failed state to receive 'failure' result for final comment.
    if (status === 'failure') {
      core.setOutput('job_result', 'failure');
    }
  }

  // Add a final workflow status and details about all jobs from the needs context.
  if (statusConfig.includes('workflow')) {
    let status = 'cancelled';
    let successCount = 0;
    let failureCount = 0;
    for (const jobID in needsContext) {
      if (!needsContext.hasOwnProperty(jobID)) {
        continue;
      }
      // Ignore helper jobs.
      if (jobID === 'started_at' || jobID === 'git_info') {
        continue
      }

      let jobName = jobID;
      if (needsContext[jobID].outputs && needsContext[jobID].outputs['job_name']) {
        jobName = needsContext[jobID].outputs['job_name'];
      }
      const jobResult = needsContext[jobID].result;

      if (jobResult === 'success') {
        successCount++;
      }
      if (jobResult === 'failure') {
        failureCount++;
      }

      // Info for not started job.
      if ((jobResult === 'cancelled' || jobResult === 'skipped') && !statusConfig.includes(',no-skipped')) {
        nonReportedJobs += renderJobStatusOneLine({status: jobResult, name: jobName}) + `\n`;
      }

      // Restore information for overridden job. Only result, no elapsed time here.
      if ((jobResult === 'success' || jobResult === 'failure') && !comment.includes(`<!-- result-for: ${jobName} -->`)) {
        let jobReport = '';
        if (statusConfig.includes(',restore-one-line')) {
          jobReport = renderJobStatusOneLine({status: jobResult, name: jobName});
        } else if (statusConfig.includes(',restore-separate')) {
          jobReport = renderJobStatusSeparate({status: jobResult, name: jobName});
        }
        nonReportedJobs += jobReport+`\n`;
      }
    }
    if (successCount > 0) {
      status = 'success';
    }
    if (failureCount > 0) {
      status = 'failure';
      failedInfo = `${failureCount} job${failureCount > 1 ? 's' : ''} failed`;
      core.setFailed(`Workflow ${name} failed: ${failedInfo}.`);
      failedInfo = ` (${failedInfo})`;
    }

    core.info(`Status for workflow report is ${status}`);

    statusReport = renderWorkflowStatusFinal({ status, name, ref, build_url, time_elapsed });
  }


  if (statusConfig.includes(',final')) {
    // Cleanup first line with the response from the bot.
    comment = comment.replace(/^Aye,.*\n/m, '');
    // Split comment to save a header.
    const parts = comment.split('<!-- workflow_start -->');
    if (parts[1]) {
      // If non-empty jobs report present in comment, wrap it in a 'details' tag.
      // Clean it from multiple lines with 'started' statuses.
      const header = parts[0];
      let jobsReport = parts[1];
      jobsReport = jobsReport.replace(/^.*:fast_forward:.*started.*\.\n\n?/mg, '');
      jobsReport += `\n${nonReportedJobs||''}`;

      // Wrap jobs report with 'details' tag if not empty.
      let workflowDetails = `${failedInfo}`;
      if ( ! /^\s*$/.test(jobsReport)) {
        workflowDetails = `\n<details><summary>Workflow details${failedInfo}</summary>\n${jobsReport}</details>`;
      }

      comment = `${header}\n\n${statusReport}${workflowDetails}`;
    } else {
      // No split marker: wrap entire comment with 'details' tag.
      comment = `${statusReport}\n\n<details><summary>Workflow details${failedInfo}</summary>${comment}\n${nonReportedJobs||''}</details>`;
    }
  } else {
    comment = `${comment}\n${statusReport}`;
  }

  const updateResponse = await github.rest.issues.updateComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    comment_id: comment_id,
    body: comment
  });

  core.debug(`updateComment response: ${JSON.stringify(updateResponse)}`);
  if (updateResponse.status !== 200) {
    return core.setFailed(`comment is not accessible ${JSON.stringify(updateResponse)}`);
  }
};

/**
 * Check if label is present on PR or "release" issue and set 'shouldRun'
 * output to run or skip next jobs. Also, removes the label.
 *
 * Outputs:
 * - shouldRun - 'true'/'false' indicates label presence.
 * - labels - an array of labels on issue or PR.
 *
 * @param {object} inputs
 * @param {object} inputs.github - A pre-authenticated octokit/rest.js client with pagination plugins.
 * @param {object} inputs.context - An object containing the context of the workflow run.
 * @param {object} inputs.core - A reference to the '@actions/core' package.
 * @param {string} inputs.labelType - A label prefix: 'e2e' or 'deploy-web'.
 * @param {string} inputs.labelSubject - A last part of the label.
 * @param {function} inputs.onSuccess - A callback function to run on success.
 * @returns {Promise<void|*>}
 */
const checkLabel = async ({ github, context, core, labelType, labelSubject, onSuccess }) => {
  if (context.eventName === 'workflow_dispatch' && !context.payload.inputs.issue_number) {
    core.setOutput('should_run', 'true');
    return console.log(`workflow_dispatch without issue number. Allow to proceed.`);
  }

  const shouldRunLabel = labelsSrv.findLabel({ labelType, labelSubject });
  if (shouldRunLabel === '') {
    core.setOutput('should_run', 'false');
    return console.log(`Ignore unknown label for type='${labelType}' subject='${labelSubject}'. Skip next jobs.`);
  }

  let labels = null;
  let issue_number = '';
  let isPR = false;

  // Workflow started via workflow_dispatch, get labels by issue_id.
  if (context.eventName === 'workflow_dispatch') {
    issue_number = context.payload.inputs.issue_number;
    const response = await github.rest.issues.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issue_number
    });
    if (response.status != 200) {
      return core.setFailed(`Cannot get issue by number ${issue_number}: ${JSON.stringify(response)}`);
    }

    labels = response.data.labels;
  }

  // Workflow started via workflow_dispatch, search pull_request and get labels.
  if (context.eventName === 'push') {
    isPR = true;
    const response = await github.rest.repos.listPullRequestsAssociatedWithCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      commit_sha: context.sha
    });
    if (response.status != 200) {
      return core.setFailed(`Cannot list PRs for commit ${context.sha}: ${JSON.stringify(response)}`);
    }
    // Get first associated pr.
    if (response.data && response.data.length > 0) {
      const pr = response.data.length > 0 && response.data[0];
      labels = pr.labels;
      issue_number = pr.number;
    } else {
      // Return if no PR. Do not fail for 'push' event, as these jobs can be restarted later.
      return console.log(
        `Something bad happens. No issue or pull_request found. event_name=${context.eventName} action=${context.action} ref=${context.ref}`
      );
    }
  }

  console.log(
    `'${context.eventName}' event for ${isPR ? 'PR' : 'issue'} #${issue_number} with labels: ${JSON.stringify(
      labels.map((l) => l.name)
    )}`
  );
  core.setOutput('labels', JSON.stringify(labels));

  if (!labels) {
    return core.setFailed(
      `No issue or PR found or unknown event is occurred. event_name=${context.eventName} action=${context.action} ref=${context.ref}`
    );
  }

  let hasLabel = false;
  for (const label of labels) {
    if (label.name === shouldRunLabel) {
      hasLabel = true;
    }
  }

  core.setOutput('should_run', hasLabel.toString());

  if (onSuccess) {
    onSuccess({ labels, hasLabel });
  }

  if (!hasLabel) {
    console.log(`${isPR ? 'PR' : 'Issue'} #${issue_number} has no label '${shouldRunLabel}'. Skip next jobs.`);
    return;
  }
  // Remove label
  console.log(`Requested label '${shouldRunLabel}' is present. Remove it now...`);
  try {
    await github.rest.issues.removeLabel({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issue_number,
      name: shouldRunLabel
    });
    console.log(`  Done.`);
  } catch (e) {
    console.log(`  It seems label was removed by another workflow. Ignore ${typeof e} error.`);
  }
  console.log(`Proceed to next jobs.`);
};
module.exports.checkLabel = checkLabel;

/**
 * Check e2e/use labels to determine which cri/version job to run for provider.
 *
 * This method set 'true'/'false' outputs for each cri/version job.
 *
 * @param {object} inputs
 * @param {object} inputs.github - A pre-authenticated octokit/rest.js client with pagination plugins.
 * @param {object} inputs.context - An object containing the context of the workflow run.
 * @param {object} inputs.core - A reference to the '@actions/core' package.
 * @param {string} inputs.provider - A slug of the provider.
 * @returns {Promise<void>}
 */
module.exports.checkE2ELabels = async ({ github, context, core, provider }) => {
  // Get labels from PR
  const defaultCRI = e2eDefaults.criName.toLowerCase();
  const defaultVersion = e2eDefaults.kubernetesVersion.replace(/\./g, '_');

  // Shortcut for release related runs (not pull requests).
  if (!context.payload.inputs.pull_request_ref) {
    let cri = [defaultCRI];
    let ver = [defaultVersion];

    if (!!context.payload.inputs.cri) {
      const requested_cri = context.payload.inputs.cri.toLowerCase();
      cri = requested_cri.split(',');
    }
    if (!!context.payload.inputs.ver) {
      const requested_ver = context.payload.inputs.ver.replace(/\./g, '_');
      ver = requested_ver.split(',');
    }

    core.info(`workflow_dispatch is release related. e2e inputs: cri='${context.payload.inputs.cri}' and version='${context.payload.inputs.ver}'.`);

    for (const out_cri of cri) {
      for (const out_ver of ver) {
        core.info(`run_${out_cri}_${out_ver}: true`);
        core.setOutput(`run_${out_cri}_${out_ver}`, 'true');
      }
    }
    return
  }

  // Request fresh info about the pull request.
  let issueLabels = [];
  let shouldRun = false;
  await checkLabel({
    github,
    context,
    core,
    labelType: 'e2e',
    labelSubject: provider,
    onSuccess: ({ labels, hasLabel }) => {
      issueLabels = labels;
      shouldRun = hasLabel;
    }
  });

  if (!shouldRun) {
    console.log(`No e2e label for provider '${provider}'. Skip next jobs.`);
    return;
  }

  let useLabels = [];
  if (issueLabels) {
    for (const label of issueLabels) {
      if (label.name.startsWith('e2e/use')) {
        useLabels.push(label.name);
      }
    }
  }
  core.info(`e2e/use labels: ${JSON.stringify(useLabels)}`);

  let ver = [];
  let cri = [];
  for (const label of useLabels) {
    for (const criName of knownCRINames) {
      if (label.includes(criName.toLowerCase())) {
        cri.push(criName.toLowerCase());
      }
    }
    for (const kubernetesVersion of knownKubernetesVersions) {
      if (label.includes(kubernetesVersion)) {
        ver.push(kubernetesVersion.replace(/\./g, '_'));
      }
    }
  }

  if (ver.length === 0) {
    core.info(`No additional 'e2e/use/k8s' labels found. Will run e2e with default version=${defaultVersion}.`)
    ver = [defaultVersion];
  }
  if (cri.length === 0) {
    core.info(`No additional 'e2e/use/cri' labels found. Will run e2e with default cri=${defaultCRI}.`);
    cri = [defaultCRI];
  }

  for (const out_cri of cri) {
    for (const out_ver of ver) {
      core.info(`run_${out_cri}_${out_ver}: true`);
      core.setOutput(`run_${out_cri}_${out_ver}`, 'true');
    }
  }
};

/**
 * Check 'skip validation' labels, set boolean outputs for validation jobs.
 *
 * Outputs:
 * - run_<validation_type> - A boolean to start or skip a job.
 * - label_<validation_type> - A label name to use in failure message.
 * - diff_url - An URL to fetch full diff for PR.
 * - pr_title - A title of PR.
 * - pr_description - A description of PR.
 *
 * @param {object} inputs
 * @param {object} inputs.github - A pre-authenticated octokit/rest.js client with pagination plugins.
 * @param {object} inputs.context - An object containing the context of the workflow run.
 * @param {object} inputs.core - A reference to the '@actions/core' package.
 * @returns {Promise<void|*>}
 */
module.exports.checkValidationLabels = async ({ github, context, core }) => {
  // Run all validations by default.
  core.setOutput('run_no_cyrillic', 'true');
  core.setOutput('run_doc_changes', 'true');
  core.setOutput('run_copyright', 'true');

  // This method runs on pull_request_target, so pull_request context is available.

  // Fetch fresh pull request state using sha.
  // Why? Workflow rerun of 'opened' pull request contains outdated labels.
  const owner = context.payload.pull_request.head.repo.owner.login
  const repo = context.payload.pull_request.head.repo.name
  const commit_sha = context.payload.pull_request.head.sha
  core.info(`List pull request inputs: ${JSON.stringify({ owner, repo, commit_sha })}`);
  const response = await github.rest.repos.listPullRequestsAssociatedWithCommit({ owner, repo, commit_sha });
  if (response.status != 200) {
    return core.setFailed(`Cannot list PRs for commit ${commit_sha}: ${JSON.stringify(response)}`);
  }

  // No PR found, do not run validations.
  if (!response.data || response.data.length === 0) {
    return core.setFailed(`No pull_request found. event_name=${context.eventName} action=${context.action}`);
  }

  const pr = response.data[0];

  // Check labels and disable corresponding validations.
  for (const skipLabel of knownLabels['skip-validation']) {
    let prHasSkipLabel = pr.labels.some((l) => l.name === skipLabel);

    let validationName = '';
    if (/no-cyrillic/.test(skipLabel)) {
      validationName = 'no_cyrillic';
      core.info(`Skip 'no-cyrillic'`);
    }
    if (/documentation/.test(skipLabel)) {
      validationName = 'doc_changes';
      core.info(`Skip 'doc-changes'`);
    }
    if (/copyright/.test(skipLabel)) {
      validationName = 'copyright';
      core.info(`Skip 'copyright'`);
    }

    if (prHasSkipLabel) {
      core.setOutput(`run_${validationName}`, 'false');
    }
    core.setOutput(`label_${validationName}`, skipLabel);
  }

  core.setOutput('pr_title', pr.title);
  core.info(`pr_title='${pr.title}'`);

  core.setOutput('pr_description', pr.body);
  core.info(`pr_description='${pr.body}'`);

  core.setOutput('diff_url', pr.diff_url);
  core.info(`diff_url='${pr.diff_url}'`);
};

/**
 * Detect slash command in the comment.
 * Commands are similar to labels:
 *   /build release-1.30
 *   /e2e/run/aws v1.31.0-alpha.0
 *   /e2e/use/k8s/1.22
 *   /e2e/use/k8s/1.19
 *   /e2e/use/cri/docker
 *   /e2e/use/cri/containerd
 *   /deploy/web/stage v1.3.2
 *   /deploy/alpha - to deploy all editions
 *   /deploy/alpha/ce,ee,fe
 *   /suspend/alpha
 *
 * @param {object} inputs
 * @param {object} inputs.comment - A comment body.
 * @returns {object}
 */
const detectSlashCommand = ({ comment }) => {
  // Split comment to lines.
  const lines = comment.split(/\r\n|\n|\r/).filter(l => l.startsWith('/'));
  if (lines.length < 1) {
    return {notFoundMsg: 'first line is not a slash command'}
  }

  // Search for user command in the first line of the comment.
  // User command is a command and a tag name.
  const parts = lines[0].split(/\s+/);

  if ( ! /^\/[a-z\d_\-\/]+$/.test(parts[0])) {
    return {notFoundMsg: 'not a slash command in the first line'};
  }

  const command = parts[0];
  let gitRefInfo = null;
  let workflow_ref = '';

  if (parts[1]) {
    // Allow branches main and release-X.Y.
    if (parts[1] === 'main' || /^release-\d+\.\d+$/.test(parts[1])) {
      workflow_ref = 'refs/heads/' + parts[1];
    }
    // Allow vX.Y.Z and test-vX.Y.Z* tags
    if (/^(v\d+\.\d+\.\d+|test-v?\d+\.\d+\.\d+.*)$/.test(parts[1])) {
      workflow_ref = 'refs/tags/' + parts[1];
    }

    if (workflow_ref) {
      gitRefInfo = getGitRefInfo(workflow_ref)
    } else {
      return {notFoundMsg: `git_ref ${parts[1]} not allowed. Only main, release-X.Y, vX.Y.Z or test-vX.Y.Z.`};
    }
  }

  let workflow_id = '';
  let inputs = null;

  // Detect /e2e/run/* commands and /e2e/use/* arguments.
  const isE2E = knownLabels.e2e.some(l => command.startsWith('/'+l));
  if (isE2E) {
    for (const provider of knownProviders) {
      if (command.includes(provider)) {
        workflow_id = `e2e-${provider}.yml`;
        break;
      }
    }

    // Extract cri and ver from the rest lines or use defaults.
    if (workflow_id) {
      let ver = [];
      let cri = [];
      for (const line of lines) {
        let useParts = line.split('/e2e/use/cri/');
        if (useParts[1]) {
          cri.push(useParts[1]);
        }
        useParts = line.split('/e2e/use/k8s/');
        if (useParts[1]) {
          ver.push(useParts[1]);
        }
      }

      inputs = {
        cri: cri.join(','),
        ver: ver.join(','),
      }
    }
  }

  // Detect /deploy/* commands.
  const isDeploy = knownSlashCommands.deploy.some(c => command.startsWith('/'+c));
  if (isDeploy) {
    for (const channel of knownChannels) {
      if (command.includes('/'+channel)) {
        workflow_id = `deploy-${channel}.yml`;
        break;
      }
    }
    // Extract editions if command consists of 3 parts: /deploy/alpha/ce,ee v1.3.2-alpha.0
    const cmdParts = command.split('/');
    if (workflow_id && cmdParts[3]) {
      inputs = {
        editions: cmdParts[3],
      }
    }
  }

  // Detect /suspend/* commands.
  const isSuspend = knownSlashCommands.suspend.some(c => command.startsWith('/'+c));
  if (isSuspend) {
    for (const channel of knownChannels) {
      if (command.includes(channel)) {
        workflow_id = `suspend-${channel}.yml`;
        break;
      }
    }
  }

  const isBuild = command === '/build';
  if (isBuild) {
    workflow_id = 'build-and-test_release.yml';
  }

  if (workflow_id === '') {
    return {notFoundMsg: `workflow for '${command}' not found`};
  }

  return {
    command,
    gitRefInfo,
    workflow_ref,
    workflow_id,
    inputs,
    isSuspend,
    isDeploy,
    isE2E,
    isBuild,
  };
};

/**
 * Set reaction to issue comment.
 *
 * @param {object} inputs
 * @param {object} inputs.github - A pre-authenticated octokit/rest.js client with pagination plugins.
 * @param {object} inputs.context - An object containing the context of the workflow run.
 * @param {object} inputs.comment_id - ID of the issue comment.
 * @param {object} inputs.content - Reaction type: (+1, -1, rocket, confused, ...).
 * @returns {Promise<void|*>}
 */
const reactToComment = async ({github, context, comment_id, content}) => {
  return await github.rest.reactions.createForIssueComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    comment_id,
    content,
  });
};

/**
 * Use issue comment to determine a workflow to run.
 *
 * @param {object} inputs
 * @param {object} inputs.github - A pre-authenticated octokit/rest.js client with pagination plugins.
 * @param {object} inputs.context - An object containing the context of the workflow run.
 * @param {object} inputs.core - A reference to the '@actions/core' package.
 * @returns {Promise<void|*>}
 */
module.exports.runSlashCommandForReleaseIssue = async ({ github, context, core }) => {
  const event = context.payload;
  const milestoneTitle = event.issue.milestone.title;
  const comment_id = event.comment.id;
  core.debug(`Event: ${JSON.stringify(event)}`);

  const slashCommand = detectSlashCommand({ comment: event.comment.body });
  if (slashCommand.notFoundMsg) {
    return core.info(`Ignore comment: ${slashCommand.notFoundMsg}.`);
  }

  core.info(`Command detected: ${JSON.stringify(slashCommand)}`);

  let failedMsg = '';

  if (slashCommand.isE2E || slashCommand.isBuild) {
    // Check if Git ref is allowed.
    if (!slashCommand.gitRefInfo) {
      failedMsg = `Command '${slashCommand.command}' requires an argument with a tag in form vX.Y.Z, test-vX.Y.Z* or branch 'main' or 'release-X.Y'.`
    } else if (slashCommand.gitRefInfo.tagVersion) {
      // Version in Git tag should relate to the milestone.
      if (!milestoneTitle.includes(slashCommand.gitRefInfo.tagVersion)) {
        failedMsg = `Git ref for command '${slashCommand.command}' should relate to the milestone ${milestoneTitle}: got ${slashCommand.workflow_ref}.`
      }
    } else if (slashCommand.gitRefInfo.isReleaseBranch) {
      // Major.Minor in release branch should relate to the milestone.
      if (!milestoneTitle.includes(slashCommand.gitRefInfo.branchMajorMinor)) {
        failedMsg = `Git ref for command '${slashCommand.command}' should relate to the milestone ${milestoneTitle}: got ${slashCommand.workflow_ref}.`
      }
    } else if (!slashCommand.gitRefInfo.isMain) {
      failedMsg = `Command '${slashCommand.command}' requires a tag in form vX.Y.Z, test-vX.Y.Z* or branch 'main' or 'release-X.Y', got ${slashCommand.workflow_ref}.`
    }
  } else if (slashCommand.isDeploy || slashCommand.isSuspend) {
    // Extract tag name from milestone title for deploy and suspend commands.
    const matches = milestoneTitle.match(/v\d+\.\d+\.\d+/);
    if (matches) {
      slashCommand.workflow_ref = `refs/tags/${matches[0]}`;
    } else {
      failedMsg = `Command '${slashCommand.command}' requires issue to relate to milestone with version in title. Got milestone '${event.issue.milestone.title}'.`
    }
  }

  // Git ref is malformed.
  if (failedMsg) {
    core.setFailed(failedMsg);
    return await reactToComment({github, context, comment_id, content: 'confused'});
  }

  core.info(`Use ref '${slashCommand.workflow_ref}' for workflow.`);

  // React with rocket!
  await reactToComment({github, context, comment_id, content: 'rocket'});

  // Add new issue comment and start the requested workflow.
  core.info('Add issue comment to report workflow status.');
  let response = await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: event.issue.number,
    body: `Aye, aye, @${event.comment.user.login}. I've recognized your '${slashCommand.command}' command and started the workflow...\n<!-- workflow_start -->`
  });

  if (response.status !== 201) {
    return core.setFailed(`Cannot start workflow: ${JSON.stringify(response)}`);
  }

  const commentInfo = {
    issue_id: '' + event.issue.id,
    issue_number: '' + event.issue.number,
    comment_id: '' + response.data.id,
  };

  return await startWorkflow({github, context, core,
    workflow_id: slashCommand.workflow_id,
    ref: slashCommand.workflow_ref,
    inputs: {
      ...commentInfo,
      ...slashCommand.inputs
    },
  });
};

/**
 * Get labels from PR and determine a workflow to run next.
 *
 * @param {object} inputs
 * @param {object} inputs.github - A pre-authenticated octokit/rest.js client with pagination plugins.
 * @param {object} inputs.context - An object containing the context of the workflow run.
 * @param {object} inputs.core - A reference to the '@actions/core' package.
 * @param {string} inputs.ref - A git ref to checkout head commit for PR (e.g. refs/pull/133/head).
 * @returns {Promise<void>}
 */
module.exports.runWorkflowForPullRequest = async ({ github, context, core, ref }) => {
  const event = context.payload;
  const label = event.label.name;
  let command = {action: 'run_workflow_dispatch', workflows:[]};

  console.log(`Event label name: '${label}'`);
  console.log(`Known labels: ${JSON.stringify(knownLabels, null, '  ')}`);
  console.log(`Git ref: '${ref}'`);

  if (knownLabels.e2e.includes(label) && event.action === 'labeled') {
    for (const provider of knownProviders) {
      if (label.includes(provider)) {
        command.workflows = [`e2e-${provider}.yml`];
        break;
      }
    }
  }

  if (knownLabels['deploy-web'].includes(label) && event.action === 'labeled') {
    // prod env is not available for pull request.
    for (const webEnv of ['test', 'stage']) {
      if (label.includes(webEnv)) {
        command.workflows = [`deploy-web-${webEnv}.yml`];
        break;
      }
    }
  }

  if (knownLabels['skip-validation'].includes(label)) {
    command.workflows = ['validation.yml'];
    command.action = 'rerun_workflow';
  }

  if (knownLabels['ok-to-test'] === label) {
    command.workflows = ['build-and-test_dev.yml', 'validation.yml'];
    command.action = 'rerun_workflow';
  }

  if (command.workflows.length === 0) {
    return console.log(`Workflow for label '${event.label.name}' and action '${event.action}' not found. Ignore it.`);
  }

  if (command.action === 'rerun_workflow') {
    core.info(`Label '${label}' was set on PR#${context.payload.pull_request.number}. Will retry workflows: '${JSON.stringify(command.workflows)}'.`);
    for (const workflow_id of command.workflows) {
      await findAndRerunWorkflow({github, context, core, workflow_id});
    }
  }

  if (command.action === 'run_workflow_dispatch') {
    const workflow_id = command.workflows[0];
    core.info(`Label '${label}' was set on PR#${context.payload.pull_request.number}. Will start workflow '${workflow_id} via workflow_dispatch event'.`);

    // workflow_dispatch requires a ref. In PRs from forks, we assign images with `prXXX` tags to
    // avoid clashes with inner branches.
    const prNumber = context.payload.pull_request.number;

    // Add a comment to pull request.
    core.info(`Add comment to pull request ${prNumber}.`);
    let response = await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      body: `Aye, aye, @${context.payload.sender.login}. I've started the workflow for label '${label}'...\n<!-- workflow_start -->`
    });

    if (response.status < 200 || response.status >= 300) {
      return core.setFailed(`Cannot start workflow: ${JSON.stringify(response)}`);
    }

    const commentInfo = {
      issue_id: '' + context.payload.pull_request.id,
      issue_number: '' + prNumber,
      comment_id: '' + response.data.id,
    }

    const targetRepo = context.payload.repository.full_name;
    const prRepo = context.payload.pull_request.head.repo.full_name;
    const prRef = context.payload.pull_request.head.ref
    const prInfo = {
      ci_commit_ref_name: (prRepo === targetRepo) ? prRef : `pr${prNumber}`,
      pull_request_ref: ref,
      pull_request_sha: context.payload.pull_request.head.sha,
      pull_request_head_label: context.payload.pull_request.head.label,
    };

    return await startWorkflow({github, context, core,
      workflow_id,
      ref: 'refs/heads/main',
      inputs: {
        ...commentInfo,
        ...prInfo
      },
    });
  }

};

const findAndRerunWorkflow = async ({ github, context, core, workflow_id }) => {
  // Retrieve latest workflow run and rerun it.
  let response = await github.rest.actions.listWorkflowRuns({
    owner: context.repo.owner,
    repo: context.repo.repo,
    workflow_id: workflow_id,
    branch: context.payload.pull_request.head.ref
  });

  if (!response.data.workflow_runs || response.data.workflow_runs.length === 0) {
    console.log(`ListWorkflowRuns response: ${JSON.stringify(response)}`);
    return core.setFailed(`No runs found for workflow '${workflow_id}'. Just return.`);
  }

  let lastRun = null;
  for (const wr of response.data.workflow_runs) {
    if (wr.head_sha === context.payload.pull_request.head.sha) {
      lastRun = wr;
      break;
    }
  }

  if (!lastRun) {
    return core.setFailed(`Workflow run of '${workflow_id}' not found for PR#${context.payload.pull_request.number} and SHA=${context.payload.pull_request.head.sha}.`);
  }

  console.log(`Found last workflow run of '${workflow_id}'. ID ${lastRun.id}, run number ${lastRun.run_number}, started at ${lastRun.run_started_at}`);

  try {
    const response = await github.rest.actions.retryWorkflow({
      owner: context.repo.owner,
      repo: context.repo.repo,
      run_id: lastRun.id
    });

    if (response.status > 200 && response.status < 300) {
      console.log('RetryWorkflow called successfully');
    } else {
      console.log(`Error calling RetryWorkflow. Response: ${JSON.stringify(response)}`);
    }
  } catch (error) {
    console.log(`Ignore error: ${dumpError(error)}`);
  }
}

/**
 * Create new "release" issue when new milestone is created.
 *
 * @param {object} inputs
 * @param {object} inputs.github - A pre-authenticated octokit/rest.js client with pagination plugins.
 * @param {object} inputs.context - An object containing the context of the workflow run.
 * @param {object} inputs.core - A reference to the '@actions/core' package.
 * @returns {Promise<*>}
 */
module.exports.createReleaseIssueForMilestone = async ({ github, context, core }) => {
  const milestone = context.payload.milestone;

  const found = milestone.title.match(/(v\d+\.\d+\.\d+)/);
  if (!found) {
    return core.setFailed(`Milestone '${milestone.title}' not dedicated to release version in form of vX.Y.Z. Ignore creating release issue.'`);
  }
  const milestoneVersion = found[1];

  // NOTE: non-breaking space after emoji.
  const issueBody = `:robot: A dedicated issue to run tests and deploy release [${milestoneVersion}](${milestone.html_url}).

---

<details>
<summary>Release issue commands and options</summary>
<br />

You can trigger release actions by commenting on this issue:

- \`/deploy/<channel>\` will publish built images into the release channel.
  - \`channel\` is one of \`alpha | beta | early-access | rock-solid | stable\`
- \`/suspend/<channel>\` will suspend released version.
  - \`channel\` is one of \`alpha | beta | early-access | rock-solid | stable\`
- \`/e2e/run/<provider> git_ref\` will run e2e using provider and an \`install\` image built from git_ref.
  - \`provider\` is one of \`aws | azure | gcp | yandex-cloud | openstack | vsphere | static\`
  - \`git_ref\` is a tag or branch: \`vX.Y.Z | test-X.Y.Z* | main | release-X.Y\`
- \`/e2e/use/cri/<cri_name>\` specifies which CRI to use for e2e test.
  - \`cri_name\` is one of \`docker | containerd\`
- \`/e2e/use/k8s/<version>\` specifies which Kubernetes version to use for e2e test.
  - \`version\` is one of \`1.19 | 1.20 | 1.21 | 1.22\`
- \`/build git_ref\` will run build.
  - \`git_ref\` is a tag or branch: \`vX.Y.Z | test-X.Y.Z* | main | release-X.Y\`


**Note 1:**
A single command \`/e2e/run/<provider>\` will run e2e with default CRI 'containerd' and Kubernetes version '1.21'.
Put \`/e2e/use\` options below \`/e2e/run\` command to set specific CRI and Kubernetes version. E.g.:

\`\`\`
/e2e/run/aws
/e2e/use/cri/docker
/e2e/use/cri/containerd
/e2e/use/k8s/1.19
/e2e/use/k8s/1.21

This comment will run 4 e2e jobs on AWS with Docker and containerd
and with Kubernetes version 1.19 and 1.21.
\`\`\`

**Note 2:**
'deploy', 'suspend' and 'e2e' commands should run after 'build modules FE' and 'build FE' jobs are finished.

</details>`;

  const response = await github.rest.issues.create({
    owner: context.repo.owner,
    repo: context.repo.repo,
    title: `Release ${milestoneVersion}`,
    body: issueBody,
    milestone: milestone.number,
    labels: ['issue/release']
  });

  if (response.status != 201) {
    return core.setFailed(`Create issue failed: ${JSON.stringify(response)}`);
  }
};

/**
 * Find the recent milestone related to the Git ref.
 *
 * @param {object} inputs
 * @param {object} inputs.github - A pre-authenticated octokit/rest.js client with pagination plugins.
 * @param {object} inputs.context - An object containing the context of the workflow run.
 * @param {object} inputs.core - A reference to the '@actions/core' package.
 * @param {object} inputs.gitRefInfo - A Git ref info.
 * @returns {object} - A milestone or an error message.
 */
const findMilestoneForGitRef = async ({ github, context, core, gitRefInfo }) => {
  // Find first 25 recently created milestones.
  const query = `
    query($owner:String!, $name:String!) {
      repository(owner:$owner, name:$name){
        milestones(first:25, orderBy:{field:CREATED_AT, direction:DESC}, states:[OPEN]) {
          edges {
            node {
              title
              number
            }
          }
        }
      }
    }`;

  const variables = {
    owner: context.repo.owner,
    name: context.repo.repo
  };

  let result;
  try {
    result = await github.graphql(query, variables);
  } catch (error) {
    if (error.name === 'GraphqlResponseError') {
      core.log('Request:', error.request);
      return {notFoundMsg: error.message}
    } else {
      // handle non-GraphQL error
      return {notFoundMsg: `List milestones failed: ${dumpError(error)}`}
    }
  }

  // Find milestone with tag in title.
  const milestones = result.repository.milestones.edges;
  let milestone = null;
  if (gitRefInfo.isMain) {
    // Get first milestone with appropriate title. It should be the latest milestone.
    for (const m of milestones) {
      if (/^v\d+\.\d+\.\d+/.test(m.node.title)) {
        milestone = m.node;
        break;
      }
    }
  } else if (gitRefInfo.tagVersion) {
    for (const m of milestones) {
      if (` ${m.node.title} `.includes(` ${gitRefInfo.tagVersion} `)) {
        milestone = m.node;
        break;
      }
    }
  }

  if (!milestone) {
    core.info(`Milestones: ${JSON.stringify(result)}`);
    return {notFoundMsg: `No related milestone found for ref '${context.ref}'. You should create milestone related to a tag and restart build.`}
  }

  core.info(`Found milestone related to ref '${context.ref}': '${milestone.title}' with number ${milestone.number}`);
  return milestone;
}

/**
 * Find first issue related to the milestone and labeled as release issue.
 */
const findReleaseIssueForMilestone = async ({ github, context, core, milestone }) => {
  // Milestone should have release issue to comment. Find it by the specific label.
  let response = await github.rest.issues.listForRepo({
    owner: context.repo.owner,
    repo: context.repo.repo,
    milestone: milestone.number,
    state: 'open',
    labels: [knownLabels['issue-release']]
  });
  if (response.status !== 200 || response.data.length < 1) {
    return {notFoundMsg: `List milestone issues failed: ${JSON.stringify(response)}`};
  }

  return response.data[0];
}

/**
 * Add comment for build workflow.
 *
 * @param {object} args
 * @param {object} args.github - A pre-authenticated octokit/rest.js client with pagination plugins.
 * @param {object} args.context - An object containing the context of the workflow run.
 * @param {object} args.core - A reference to the '@actions/core' package.
 * @param {object} args.issue - A release issue object.
 * @param {object} args.gitRefInfo - A Git ref info.
 * @returns {Promise<void>}
 */
const addReleaseIssueComment = async ({ github, context, core, issue, gitRefInfo }) => {
  // Add issue comment.
  let comment_body = '';
  if (gitRefInfo.isTag) {
    comment_body = `New tag **${gitRefInfo.tagName}** is created.\n<!-- workflow_start -->`;
  }
  if (gitRefInfo.isBranch) {
    const commitMiniSHA = context.payload.head_commit.id.slice(0, 6);
    const commitUrl = context.payload.head_commit.url;
    const header = `New commit [${commitMiniSHA}](${commitUrl}) in branch **${gitRefInfo.branchName}**:`;
    // Format commit message.
    const mdCodeMarker = '```';
    const commitMsg = `${mdCodeMarker}\n${context.payload.head_commit.message}\n${mdCodeMarker}`;
    comment_body = `${header}\n${commitMsg}\n<!-- workflow_start -->`;
  }
  core.info('Add issue comment.');
  const response = await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issue.number,
    body: comment_body
  });

  if (response.status != 201) {
    return core.setFailed(`Create issue comment failed: ${JSON.stringify(response)}`);
  }

  return {
    issue_id: '' + issue.id,
    issue_number: '' + issue.number,
    comment_id: '' + response.data.id,
  }
}

/**
 * Start workflow using workflow_dispatch event.
 *
 * @param {object} args
 * @param {object} args.github - A pre-authenticated octokit/rest.js client with pagination plugins.
 * @param {object} args.context - An object containing the context of the workflow run.
 * @param {object} args.core - A reference to the '@actions/core' package.
 * @param {object} args.workflow_id - A name of the workflow YAML file.
 * @param {object} args.ref - A Git ref.
 * @param {object} args.inputs - Inputs for the workflow_dispatch event.
 * @returns {Promise<void>}
 */
const startWorkflow = async ({ github, context, core, workflow_id, ref, inputs }) => {
  core.info(`Start workflow '${workflow_id}' using ref '${ref}' and inputs ${JSON.stringify(inputs)}.`);

  const response = await github.rest.actions.createWorkflowDispatch({
    owner: context.repo.owner,
    repo: context.repo.repo,
    workflow_id,
    ref,
    inputs: inputs || {},
  });

  core.debug(`status: ${response.status}`);
  core.debug(`workflow dispatch response: ${JSON.stringify(response)}`);

  if (response.status !== 204) {
    return core.setFailed(`Error starting workflow '${workflow_id}'. createWorkflowDispatch response: ${JSON.stringify(response)}`);
  }
  return core.info(`Workflow '${workflow_id}' started successfully`);
};

/**
 * Start 'build-and-test_release.yml' workflow depending on context.ref.
 *
 * @param {object} inputs
 * @param {object} inputs.github - A pre-authenticated octokit/rest.js client with pagination plugins.
 * @param {object} inputs.context - An object containing the context of the workflow run.
 * @param {object} inputs.core - A reference to the '@actions/core' package.
 * @returns {Promise<void>}
 */
module.exports.runBuildForRelease = async ({ github, context, core }) => {
  const gitRefInfo = getGitRefInfo(context.ref);

  // Run workflow without commenting on release issue.
  if (gitRefInfo.isDeveloperTag) {
    return await startWorkflow({github, context, core,
      workflow_id: 'build-and-test_release.yml',
      ref: context.ref});
  }

  if (gitRefInfo.isMain || gitRefInfo.tagVersion) {
    // Add a comment on the release issue for main branch
    // and tags with specified version:
    // - find milestone
    // - find release issue
    // - add comment and start the workflow.
    const milestone = await findMilestoneForGitRef({github, context, core,
      gitRefInfo});
    if (milestone.notFoundMsg) {
      return core.setFailed(milestone.notFoundMsg);
    }

    const releaseIssue = await findReleaseIssueForMilestone({github, context, core,
      milestone});
    if (releaseIssue.notFoundMsg) {
      return core.setFailed(releaseIssue.notFoundMsg);
    }

    const commentInfo = await addReleaseIssueComment({github, context, core,
      issue: releaseIssue, gitRefInfo});

    core.info(`Start build-and-test for ${gitRefInfo.description} '${context.ref}'...`);

    return await startWorkflow({github, context, core,
      workflow_id: 'build-and-test_release.yml',
      ref: context.ref,
      inputs: {
        ...commentInfo
      }
    });
  }

  return core.setFailed(`Git ref '${context.ref}' is not an auto-build tag or main branch. Ignore running build-and-test_release workflow.`);
};

/**
 * Parse the Git ref.
 *
 * @param {string} ref — A Git ref (refs/heads/* or refs/tags/*)
 * @returns {object}
 */
const getGitRefInfo = (ref) => {
  let branchName = '';
  let tagName = '';
  let version = '';
  let majorMinor = '';
  let description = '';
  let isDeveloperTag = false;

  if (ref.startsWith('refs/heads')) {
    branchName = ref.replace('refs/heads/', '');
    if (branchName === 'main') {
      description = 'default branch';
    }

    const found = branchName.match(/^release-v?(\d+\.\d+)/);
    if (found) {
      description = 'release branch';
      majorMinor = 'v'+found[1];
    }
  } else if (ref.startsWith('refs/tags/')) {
    tagName = ref.replace('refs/tags/', '');

    let found = tagName.match(/^((v[0-9]+\.[0-9]+\.)[0-9]+)$/);
    if (found) {
      version = found[1]; // vX.Y.Z
      majorMinor = found[2]; // vX.Y.
      description = 'release tag';
    }

    // test-v1.32.1-0 to test before pushing a "real" tag.
    found = tagName.match(/^(test-v?([0-9]+\.[0-9]+\.)[0-9]+)/);
    if (found) {
      version = 'v'+found[1]; // vX.Y.Z
      majorMinor = 'v'+found[2]; // vX.Y.
      description = 'test tag';
    }

    // dev-my-feature or pr-255-test.0
    if (/^(dev-|pr-)/.test(tagName)) {
      isDeveloperTag = true;
      description = 'developer tag';
    }
  }

  return {
    description,
    branchName,
    branchMajorMinor: branchName ? majorMinor : '',
    isBranch: !!branchName,
    isMain: branchName === 'main',
    isReleaseBranch: branchName.startsWith('release-') && !!majorMinor,
    tagName,
    tagVersion: tagName ? version : '',
    tagMajorMinor: tagName ? majorMinor : '',
    isTag: !!tagName,
    isDeveloperTag,
  };
}
