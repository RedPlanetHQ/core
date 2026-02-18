import { callTool } from '../src/mcp/index';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
};

async function main() {
  console.log('🧪 Codeberg Integration Manual Test Script');
  console.log('==========================================');
  console.log('This script tests the MCP tools directly using a Personal Access Token.');
  console.log('You can generate one at: https://codeberg.org/user/settings/applications\n');

  const token = process.env.CODEBERG_TOKEN || await question('Enter your Codeberg Access Token: ');
  const testOwner = process.env.CODEBERG_TEST_OWNER || await question('Enter a repo owner to test with (e.g. your username): ');
  const testRepo = process.env.CODEBERG_TEST_REPO || await question('Enter a repo name to test with: ');

  if (!token || !testOwner || !testRepo) {
    console.error('Missing required info.');
    process.exit(1);
  }

  const config = { access_token: token };

  console.log('\n🔄 1. Testing get_repo...');
  try {
    const repo = await callTool('get_repo', { owner: testOwner, repo: testRepo }, config);
    console.log('✅ Success!');
    console.log(repo.content[0].text.split('\n')[0]); // Print first line
  } catch (error: any) {
    console.error('❌ Failed:', error.message);
  }

  console.log('\n🔄 2. Testing list_issues...');
  try {
    const issues = await callTool('list_issues', { owner: testOwner, repo: testRepo, limit: 1 }, config);
    console.log('✅ Success!');
    console.log('Result preview:', issues.content[0].text.substring(0, 100).replace(/\n/g, ' '));
  } catch (error: any) {
    console.error('❌ Failed:', error.message);
  }

  console.log('\n🔄 3. Testing search_repositories...');
  try {
    const search = await callTool('search_repositories', { q: 'core', limit: 1 }, config);
    console.log('✅ Success!');
    console.log('Result preview:', search.content[0].text.substring(0, 100).replace(/\n/g, ' '));
  } catch (error: any) {
    console.error('❌ Failed:', error.message);
  }

  console.log('\n✨ Test Complete.');
  rl.close();
  process.exit(0);
}

main().catch(console.error);
