/**
 * Uploads the locally-created App Store Connect API key (asc-api-key.json) to the
 * EAS server credentials store and assigns it to @smart-patel-tech-solutions/timetrack
 * for the submission service — enabling fully non-interactive `eas submit`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const EAS = 'C:/Users/Ricardo Smart/AppData/Roaming/npm/node_modules/eas-cli';
const { createGraphqlClient } = require(path.join(EAS, 'build/commandUtils/context/contextUtils/createGraphqlClient.js'));
const { AccountQuery } = require(path.join(EAS, 'build/graphql/queries/AccountQuery.js'));
const { AppQuery } = require(path.join(EAS, 'build/graphql/queries/AppQuery.js'));
const iosApi = require(path.join(EAS, 'build/credentials/ios/api/GraphqlClient.js'));
const { UserRole } = require(path.join(EAS, 'node_modules/@expo/apple-utils/build/index.js'));

const ACCOUNT_NAME = 'smart-patel-tech-solutions';
const PROJECT_NAME = 'timetrack';
const BUNDLE_ID = 'com.timetrack.workforce';
const TEAM_ID = 'V9XJBN6CBK';
const TEAM_NAME = 'Ricardo Smart (Individual)';

async function main() {
  // 1. Load Expo session (state.json in ~/.expo)
  const statePath = path.join(os.homedir(), '.expo', 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  const sessionSecret = state?.auth?.sessionSecret ?? null;
  if (!sessionSecret) throw new Error('No Expo session secret found. Run `eas login` first.');

  const graphqlClient = createGraphqlClient({ accessToken: null, sessionSecret });

  // 2. Resolve account + app
  const account = await AccountQuery.getByNameAsync(graphqlClient, ACCOUNT_NAME);
  if (!account) throw new Error('Account not found: ' + ACCOUNT_NAME);
  const app = await AppQuery.byFullNameAsync(graphqlClient, `@${ACCOUNT_NAME}/${PROJECT_NAME}`);
  if (!app) throw new Error('App not found');

  const appLookupParams = {
    account: { id: account.id, name: account.name },
    projectName: PROJECT_NAME,
    bundleIdentifier: BUNDLE_ID,
  };

  // 3. Ensure Apple team exists on EAS
  const appleTeam = await iosApi.createOrGetExistingAppleTeamAndUpdateNameIfChangedAsync(graphqlClient, account.id, {
    appleTeamIdentifier: TEAM_ID,
    appleTeamName: TEAM_NAME,
  });

  // 4. Upload ASC API key to EAS credentials store
  const keyFile = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'asc-api-key.json'), 'utf-8'));
  const ascApiKey = await iosApi.createAscApiKeyAsync(graphqlClient, account, {
    keyId: keyFile.key_id,
    issuerId: keyFile.issuer_id,
    keyP8: keyFile.key_p8,
    name: 'TimeTrack Submission Key',
    roles: [UserRole.ADMIN],
    teamId: TEAM_ID,
    teamName: TEAM_NAME,
  });
  console.log('ASC API key stored on EAS:', ascApiKey.id, ascApiKey.keyIdentifier);

  // 5. Ensure app identifier + app credentials exist, then assign key for submissions
  await iosApi.createOrGetExistingAppleAppIdentifierAsync(graphqlClient, appLookupParams, appleTeam);
  const appCredentials = await iosApi.createOrGetIosAppCredentialsWithCommonFieldsAsync(graphqlClient, appLookupParams, { appleTeam });
  await iosApi.updateIosAppCredentialsAsync(graphqlClient, appCredentials, {
    ascApiKeyIdForSubmissions: ascApiKey.id,
  });

  console.log('ASC API key assigned to app for submissions. Non-interactive eas submit is now enabled.');
}

main().catch((err) => {
  console.error('FAILED:', err?.message || err);
  process.exit(1);
});