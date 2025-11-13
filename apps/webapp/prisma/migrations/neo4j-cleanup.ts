import { getNeo4jDriver } from '../../app/lib/neo4j.server';

/**
 * Neo4j Cleanup: Remove all Space-related data
 *
 * This script removes the old Space architecture from Neo4j:
 * 1. Deletes all Space nodes
 * 2. Removes spaceIds and space properties from Episode nodes
 * 3. Removes spaceIds and space properties from Statement nodes
 *
 * Note: This does NOT migrate data - it deletes all space information
 */
export async function cleanupNeo4jSpaces() {
  const driver = getNeo4jDriver();
  const session = driver.session();

  try {
    console.log('🚀 Starting Neo4j cleanup: Removing all Space data...\n');

    // Step 1: Delete all Space nodes and their relationships
    console.log('Step 1: Deleting Space nodes...');
    const spaceResult = await session.run(`
      MATCH (s:Space)
      DETACH DELETE s
      RETURN count(s) as deletedSpaceCount
    `);
    const deletedSpaces = spaceResult.records[0]?.get('deletedSpaceCount').toNumber() || 0;
    console.log(`✓ Deleted ${deletedSpaces} Space nodes and all their relationships\n`);

    // Step 2: Remove space properties from Episode nodes
    console.log('Step 2: Cleaning Episode nodes...');
    const episodeResult = await session.run(`
      MATCH (e:Episode)
      WHERE e.spaceIds IS NOT NULL OR e.space IS NOT NULL
      REMOVE e.spaceIds, e.space
      RETURN count(e) as episodeCount
    `);
    const episodeCount = episodeResult.records[0]?.get('episodeCount').toNumber() || 0;
    console.log(`✓ Cleaned ${episodeCount} Episode nodes (removed spaceIds and space fields)\n`);

    // Step 3: Remove space properties from Statement nodes
    console.log('Step 3: Cleaning Statement nodes...');
    const statementResult = await session.run(`
      MATCH (s:Statement)
      WHERE s.spaceIds IS NOT NULL OR s.space IS NOT NULL
      REMOVE s.spaceIds, s.space
      RETURN count(s) as statementCount
    `);
    const statementCount = statementResult.records[0]?.get('statementCount').toNumber() || 0;
    console.log(`✓ Cleaned ${statementCount} Statement nodes (removed spaceIds and space fields)\n`);

    // Step 4: Verify cleanup
    console.log('Step 4: Verifying cleanup...');
    const verifyResult = await session.run(`
      MATCH (s:Space)
      WITH count(s) as spaceCount
      MATCH (e:Episode)
      WITH spaceCount, count(e.spaceIds) as episodesWithSpaceIds, count(e.space) as episodesWithSpace
      MATCH (st:Statement)
      RETURN
        spaceCount,
        episodesWithSpaceIds,
        episodesWithSpace,
        count(st.spaceIds) as statementsWithSpaceIds,
        count(st.space) as statementsWithSpace
    `);

    const record = verifyResult.records[0];
    const remainingSpaces = record?.get('spaceCount').toNumber() || 0;
    const episodesWithSpaceIds = record?.get('episodesWithSpaceIds').toNumber() || 0;
    const episodesWithSpace = record?.get('episodesWithSpace').toNumber() || 0;
    const statementsWithSpaceIds = record?.get('statementsWithSpaceIds').toNumber() || 0;
    const statementsWithSpace = record?.get('statementsWithSpace').toNumber() || 0;

    console.log(`✓ Remaining Space nodes: ${remainingSpaces} (should be 0)`);
    console.log(`✓ Episodes with spaceIds: ${episodesWithSpaceIds} (should be 0)`);
    console.log(`✓ Episodes with space: ${episodesWithSpace} (should be 0)`);
    console.log(`✓ Statements with spaceIds: ${statementsWithSpaceIds} (should be 0)`);
    console.log(`✓ Statements with space: ${statementsWithSpace} (should be 0)`);

    if (remainingSpaces > 0 || episodesWithSpaceIds > 0 || episodesWithSpace > 0 ||
        statementsWithSpaceIds > 0 || statementsWithSpace > 0) {
      throw new Error('❌ Cleanup verification failed: Some space data still exists');
    }

    console.log('\n✅ Neo4j cleanup completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`   - Deleted ${deletedSpaces} Space nodes`);
    console.log(`   - Cleaned ${episodeCount} Episode nodes`);
    console.log(`   - Cleaned ${statementCount} Statement nodes`);
    console.log('   - All space-related data has been removed from Neo4j');

  } catch (error) {
    console.error('\n❌ Neo4j cleanup failed:', error);
    throw error;
  } finally {
    await session.close();
  }
}

// Run if called directly
if (require.main === module) {
  cleanupNeo4jSpaces()
    .then(() => {
      console.log('\n✨ Cleanup script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Cleanup script failed:', error);
      process.exit(1);
    });
}
