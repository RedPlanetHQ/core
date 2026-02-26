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
  console.log('🧪 Codeberg Integration Manual Test Script (Full Parity)');
  console.log('==========================================================');

  const token = process.env.CODEBERG_TOKEN || await question('Enter your Codeberg Access Token: ');
  const testOwner = process.env.CODEBERG_TEST_OWNER || await question('Enter a repo owner to test with: ');
  const testRepo = process.env.CODEBERG_TEST_REPO || await question('Enter a repo name to test with: ');

  if (!token || !testOwner || !testRepo) {
    console.error('Missing required info.');
    process.exit(1);
  }

  const config = { access_token: token };

  console.log('\n👤 1. Testing get_me...');
  try {
    const me = await callTool('get_me', {}, config);
    console.log('✅ Success! Username:', JSON.stringify(me.content[0].text.split('\n')[0]));
  } catch (error: any) {
    console.error('❌ Failed:', error.message);
  }

  console.log('\n🏷️  2. Testing create_label...');
  const labelName = `test-label-${Date.now()}`;
  try {
    const label = await callTool('create_label', { 
      owner: testOwner, 
      repo: testRepo, 
      name: labelName,
      color: '#ff0000',
      description: 'Test label created by MCP'
    }, config);
    console.log('✅ Success!');
    console.log(label.content[0].text);
  } catch (error: any) {
    console.error('❌ Failed:', error.message);
  }

  console.log('\n🏷️  3. Testing list_labels...');
  try {
    const labels = await callTool('list_labels', { owner: testOwner, repo: testRepo }, config);
    console.log('✅ Success!');
    if (labels.content[0].text.includes(labelName)) {
      console.log(`Verified: New label "${labelName}" is in the list.`);
    } else {
      console.log('⚠️  Warning: New label not found in list.');
    }
  } catch (error: any) {
    console.error('❌ Failed:', error.message);
  }

  console.log('\n📄 4. Testing create_or_update_file...');
  const filePath = `test-file-${Date.now()}.txt`;
  try {
    const file = await callTool('create_or_update_file', { 
      owner: testOwner, 
      repo: testRepo, 
      path: filePath,
      content: 'Hello from CORE MCP!',
      message: 'Initial commit from test'
    }, config);
    console.log('✅ Success!');
    console.log(file.content[0].text);
  } catch (error: any) {
    console.error('❌ Failed:', error.message);
  }

  console.log('\n📄 5. Testing get_file_contents...');
  try {
    const contents = await callTool('get_file_contents', { 
      owner: testOwner, 
      repo: testRepo, 
      path: filePath 
    }, config);
    console.log('✅ Success!');
    console.log('Content:', contents.content[0].text);
  } catch (error: any) {
    console.error('❌ Failed:', error.message);
  }

  console.log('\n🔍 6. Testing create_issue with label NAME resolution...');
  try {
    const issue = await callTool('create_issue', { 
      owner: testOwner, 
      repo: testRepo, 
      title: 'Test Issue with Label Name',
      body: 'This issue was created to test label name resolution.',
      labels: [labelName] // Testing string-to-ID resolution
    }, config);
    console.log('✅ Success!');
    console.log(issue.content[0].text);
  } catch (error: any) {
    console.error('❌ Failed:', error.message);
  }

  console.log('\n✨ Full Parity Test Complete.');
  rl.close();
  process.exit(0);
}

main().catch(console.error);
