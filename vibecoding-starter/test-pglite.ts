import { PGlite } from '@electric-sql/pglite';

async function testPGlite() {
  console.log('Testing PGlite...');

  try {
    const db = new PGlite('./test.db');
    await db.waitReady;

    console.log('✅ PGlite initialized successfully');

    const result = await db.query('SELECT 1 as test');
    console.log('✅ Query executed:', result.rows);

    await db.close();
    console.log('✅ PGlite test passed!');
  } catch (error) {
    console.error('❌ PGlite test failed:', error);
    process.exit(1);
  }
}

testPGlite();
