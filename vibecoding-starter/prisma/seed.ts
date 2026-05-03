import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Clear existing data
  await prisma.item.deleteMany();

  // Create sample items
  const items = await Promise.all([
    prisma.item.create({
      data: {
        name: 'Sample Item 1',
        description: 'This is a sample item to demonstrate the system',
      },
    }),
    prisma.item.create({
      data: {
        name: 'Sample Item 2',
        description: 'Another sample item with a background job trigger',
      },
    }),
    prisma.item.create({
      data: {
        name: 'Sample Item 3',
        description: 'Third sample item for testing',
      },
    }),
  ]);

  console.log(`✅ Created ${items.length} sample items`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
