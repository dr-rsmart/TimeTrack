import prisma from './prisma.js';

async function seed() {
  console.log('Seeding database...');

  // Create admin user
  const adminEmail = 'admin@example.com';
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      full_name: 'Admin User',
      role: 'admin',
    },
  });
  console.log('Admin user created:', admin.email);

  // Create employee record for admin
  const employee = await prisma.employee.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      full_name: 'Admin User',
      first_name: 'Admin',
      surname: 'User',
      role: 'admin',
      status: 'active',
      position: 'Administrator',
    },
  });
  console.log('Employee record created:', employee.email);

  console.log('Seeding completed!');
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
