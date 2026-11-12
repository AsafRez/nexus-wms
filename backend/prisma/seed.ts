import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function seedWarehouse2DMatrix(params: {
  warehouseId: string;
  rows: number;
  cols: number;
  occupiedTarget: number;
  warehouseStock: { productId: string; quantity: number }[];
  inboundPartners: string[];
  outboundPartners: string[];
  refPrefix: string;
}) {
  const {
    warehouseId,
    rows,
    cols,
    occupiedTarget,
    warehouseStock,
    inboundPartners,
    outboundPartners,
    refPrefix,
  } = params;

  let createdCount = 0;
  let totalItemsInMatrix = 0;
  const locationBatch: {
    warehouseId: string;
    productId: string | null;
    row: number;
    col: number;
    code: string;
    currentItems: number;
    maxUnits: number;
    isOccupied: boolean;
  }[] = [];

  for (let r = 0; r < rows; r++) {
    const rowLetter = String.fromCharCode(65 + r);
    for (let c = 0; c < cols; c++) {
      createdCount++;
      const isOccupied = createdCount <= occupiedTarget;
      const currentItems = isOccupied ? 12 + ((r * 7 + c * 11) % 65) : 0;
      totalItemsInMatrix += currentItems;
      const assignedProductId =
        isOccupied && warehouseStock.length > 0
          ? warehouseStock[(createdCount - 1) % warehouseStock.length].productId
          : null;

      locationBatch.push({
        warehouseId,
        productId: assignedProductId,
        row: r,
        col: c,
        code: `${rowLetter}-${String(c + 1).padStart(2, '0')}`,
        currentItems,
        maxUnits: 100,
        isOccupied,
      });
    }
  }

  await prisma.storageLocation.createMany({ data: locationBatch });

  await prisma.warehouse.update({
    where: { id: warehouseId },
    data: {
      usedCapacity: occupiedTarget,
      totalItems: totalItemsInMatrix,
    },
  });

  // Seed current warehouse-level ItemInventory directly on Warehouse
  if (warehouseStock.length > 0) {
    await prisma.itemInventory.createMany({
      data: warehouseStock.map((stock) => ({
        warehouseId,
        productId: stock.productId,
        quantity: stock.quantity,
      })),
    });
  }

  // Seed Inbound & Outbound movements in a single batch for fast cloud DB seeding
  const statuses = ['COMPLETED', 'COMPLETED', 'IN_PROGRESS', 'PENDING'];
  const movementBatch: {
    warehouseId: string;
    productId: string;
    type: string;
    referenceCode: string;
    partnerName: string;
    locationCode: string;
    quantity: number;
    status: string;
    createdAt: Date;
  }[] = [];

  for (let m = 0; m < 6; m++) {
    const targetStock = warehouseStock[m % warehouseStock.length];
    if (!targetStock) break;

    const nowOffset = new Date(Date.now() - m * 3600 * 1000 * 5);
    const sampleCode = `A-${String((m % cols) + 1).padStart(2, '0')}`;

    movementBatch.push(
      {
        warehouseId,
        productId: targetStock.productId,
        type: 'INBOUND',
        referenceCode: `PO-${refPrefix}-${101 + m}`,
        partnerName: inboundPartners[m % inboundPartners.length],
        locationCode: sampleCode,
        quantity: 25 + m * 10,
        status: statuses[m % statuses.length],
        createdAt: nowOffset,
      },
      {
        warehouseId,
        productId: targetStock.productId,
        type: 'OUTBOUND',
        referenceCode: `SO-${refPrefix}-${501 + m}`,
        partnerName: outboundPartners[m % outboundPartners.length],
        locationCode: sampleCode,
        quantity: 10 + m * 5,
        status: statuses[(m + 1) % statuses.length],
        createdAt: new Date(nowOffset.getTime() - 1800 * 1000),
      },
    );
  }

  if (movementBatch.length > 0) {
    await prisma.stockMovement.createMany({ data: movementBatch });
  }
}

async function main() {
  console.log('Resetting and seeding WMS 2D Matrix database...');

  await prisma.stockMovement.deleteMany();
  await prisma.itemInventory.deleteMany();
  await prisma.storageLocation.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  await prisma.business.deleteMany();

  const adminHash = await bcrypt.hash('Admin123!', 10);
  const demoHash = await bcrypt.hash('Demo123!', 10);

  // =========================================================================
  // BUSINESS 1: Apex Global Logistics
  // =========================================================================
  const apex = await prisma.business.create({
    data: {
      name: 'Apex Global Logistics',
      code: 'APEX',
      industry: '3PL & Supply Chain Distribution',
      isActive: true,
    },
  });

  await prisma.user.createMany({
    data: [
      {
        email: 'admin@apex-wms.com',
        passwordHash: adminHash,
        fullName: 'Daniel Cohen',
        role: 'ADMIN',
        businessId: apex.id,
      },
      {
        email: 'manager@apex-wms.com',
        passwordHash: adminHash,
        fullName: 'Maya Levi',
        role: 'MANAGER',
        businessId: apex.id,
      },
    ],
  });

  const [pScanner, pRouter, pBattery, pLabels, pBiologics, pYogurt, pSalmon, pDesk, pChair, pMonitor] =
    await Promise.all([
      prisma.product.create({
        data: {
          businessId: apex.id,
          sku: 'APX-SCN-400',
          name: 'Zebra Industrial Barcode Scanner',
          category: 'Warehouse Hardware',
          unitOfMeasure: 'PCS',
        },
      }),
      prisma.product.create({
        data: {
          businessId: apex.id,
          sku: 'APX-RTR-920',
          name: 'Enterprise Wi-Fi 6E Access Point',
          category: 'Networking',
          unitOfMeasure: 'PCS',
        },
      }),
      prisma.product.create({
        data: {
          businessId: apex.id,
          sku: 'APX-BAT-110',
          name: 'Lithium-Ion Backup Battery Pack',
          category: 'Power Systems',
          unitOfMeasure: 'BOX',
        },
      }),
      prisma.product.create({
        data: {
          businessId: apex.id,
          sku: 'APX-LBL-500',
          name: 'Thermal Pallet Shipping Labels (Roll)',
          category: 'Consumables',
          unitOfMeasure: 'ROLL',
        },
      }),
      prisma.product.create({
        data: {
          businessId: apex.id,
          sku: 'CLD-VAC-019',
          name: 'Temp-Controlled Biologics Vial Kit',
          category: 'Pharma Cold Chain',
          unitOfMeasure: 'CASE',
        },
      }),
      prisma.product.create({
        data: {
          businessId: apex.id,
          sku: 'CLD-DRY-204',
          name: 'Organic Greek Yogurt Crate (Chilled)',
          category: 'Dairy & Fresh',
          unitOfMeasure: 'CRATE',
        },
      }),
      prisma.product.create({
        data: {
          businessId: apex.id,
          sku: 'CLD-FRZ-880',
          name: 'Nordic Atlantic Salmon Fillet Pack',
          category: 'Frozen Foods',
          unitOfMeasure: 'CARTON',
        },
      }),
      prisma.product.create({
        data: {
          businessId: apex.id,
          sku: 'FLF-SNK-301',
          name: 'Ergonomic Standing Desk Frame',
          category: 'Home Office',
          unitOfMeasure: 'SET',
        },
      }),
      prisma.product.create({
        data: {
          businessId: apex.id,
          sku: 'FLF-CHR-715',
          name: 'Mesh Lumbar Task Chair',
          category: 'Furniture',
          unitOfMeasure: 'PCS',
        },
      }),
      prisma.product.create({
        data: {
          businessId: apex.id,
          sku: 'FLF-MON-270',
          name: '27" 4K IPS Studio Monitor',
          category: 'Electronics',
          unitOfMeasure: 'PCS',
        },
      }),
    ]);

  // Warehouse 1: 10 x 10 2D Matrix = 100 places, 54 occupied => 54% Full!
  const whCentral = await prisma.warehouse.create({
    data: {
      businessId: apex.id,
      name: 'Central Distribution Hub',
      code: 'TLV-01',
      city: 'Tel Aviv',
      street: '24 HaMasger Industrial Park',
      country: 'Israel',
      type: 'STANDARD',
      rows: 10,
      cols: 10,
      totalCapacity: 100,
    },
  });

  await seedWarehouse2DMatrix({
    warehouseId: whCentral.id,
    rows: 10,
    cols: 10,
    occupiedTarget: 54,
    warehouseStock: [
      { productId: pScanner.id, quantity: 420 },
      { productId: pRouter.id, quantity: 315 },
      { productId: pBattery.id, quantity: 180 },
      { productId: pLabels.id, quantity: 1250 },
    ],
    inboundPartners: ['TechSource Europe GmbH', 'GlobalPack Industries', 'Zebra EMEA Supply'],
    outboundPartners: ['KSP Retail Chain', 'Ivory Logistics', 'Tel Aviv Metro Hub'],
    refPrefix: 'TLV',
  });

  // Warehouse 2: 8 x 10 2D Matrix = 80 places, 68 occupied => 85% Full!
  const whNorthCold = await prisma.warehouse.create({
    data: {
      businessId: apex.id,
      name: 'Northern Cold Storage',
      code: 'HFA-02',
      city: 'Haifa',
      street: '8 Haifa Bay Cold-Port Blvd',
      country: 'Israel',
      type: 'COLD_STORAGE',
      rows: 8,
      cols: 10,
      totalCapacity: 80,
    },
  });

  await seedWarehouse2DMatrix({
    warehouseId: whNorthCold.id,
    rows: 8,
    cols: 10,
    occupiedTarget: 68,
    warehouseStock: [
      { productId: pBiologics.id, quantity: 640 },
      { productId: pYogurt.id, quantity: 910 },
      { productId: pSalmon.id, quantity: 530 },
    ],
    inboundPartners: ['BioMed Cold Supply', 'Galilee Fresh Farms', 'Nordic Sea Imports'],
    outboundPartners: ['Rambam Medical Center', 'Shufersal North', 'Carmel Gourmet Markets'],
    refPrefix: 'HFA',
  });

  // Warehouse 3: 10 x 12 2D Matrix = 120 places, 36 occupied => 30% Full!
  const whSouth = await prisma.warehouse.create({
    data: {
      businessId: apex.id,
      name: 'Southern Fulfillment Center',
      code: 'BSV-03',
      city: "Be'er Sheva",
      street: '42 Emek Sara Logistics Zone',
      country: 'Israel',
      type: 'FULFILLMENT',
      rows: 10,
      cols: 12,
      totalCapacity: 120,
    },
  });

  await seedWarehouse2DMatrix({
    warehouseId: whSouth.id,
    rows: 10,
    cols: 12,
    occupiedTarget: 36,
    warehouseStock: [
      { productId: pDesk.id, quantity: 145 },
      { productId: pChair.id, quantity: 290 },
      { productId: pMonitor.id, quantity: 360 },
      { productId: pLabels.id, quantity: 600 },
    ],
    inboundPartners: ['NordicDesk Manufacturing', 'StudioDisplay Corp'],
    outboundPartners: ['Negev Tech Campus', 'Direct-to-Consumer Express', 'Eilat Retail Store'],
    refPrefix: 'BSV',
  });

  // =========================================================================
  // BUSINESS 2: Nova Retail Group
  // =========================================================================
  const nova = await prisma.business.create({
    data: {
      name: 'Nova Retail Group',
      code: 'NOVA',
      industry: 'Omnichannel Fashion & Lifestyle',
      isActive: true,
    },
  });

  await prisma.user.create({
    data: {
      email: 'demo@novaretail.com',
      passwordHash: demoHash,
      fullName: 'Noa Shapira',
      role: 'ADMIN',
      businessId: nova.id,
    },
  });

  const [pCoat, pBag] = await Promise.all([
    prisma.product.create({
      data: {
        businessId: nova.id,
        sku: 'NVA-JKT-102',
        name: 'Waterproof Urban Trench Coat',
        category: 'Apparel',
        unitOfMeasure: 'PCS',
      },
    }),
    prisma.product.create({
      data: {
        businessId: nova.id,
        sku: 'NVA-BAG-450',
        name: 'Canvas Weekender Duffel Bag',
        category: 'Accessories',
        unitOfMeasure: 'PCS',
      },
    }),
  ]);

  const whNovaHerzliya = await prisma.warehouse.create({
    data: {
      businessId: nova.id,
      name: 'Herzliya Express Depot',
      code: 'HRZ-01',
      city: 'Herzliya',
      street: '11 Maskit St',
      country: 'Israel',
      type: 'FULFILLMENT',
      rows: 5,
      cols: 10,
      totalCapacity: 50,
    },
  });

  await seedWarehouse2DMatrix({
    warehouseId: whNovaHerzliya.id,
    rows: 5,
    cols: 10,
    occupiedTarget: 31,
    warehouseStock: [
      { productId: pCoat.id, quantity: 310 },
      { productId: pBag.id, quantity: 240 },
    ],
    inboundPartners: ['Milan Textile Studio', 'Lisbon Leather Co.'],
    outboundPartners: ['Ramat Aviv Flagship', 'Nova Online Orders'],
    refPrefix: 'HRZ',
  });

  const whNovaAshdod = await prisma.warehouse.create({
    data: {
      businessId: nova.id,
      name: 'Ashdod Port Bonded Hub',
      code: 'ASD-02',
      city: 'Ashdod',
      street: '3 HaNamal Zone',
      country: 'Israel',
      type: 'STANDARD',
      rows: 6,
      cols: 10,
      totalCapacity: 60,
    },
  });

  await seedWarehouse2DMatrix({
    warehouseId: whNovaAshdod.id,
    rows: 6,
    cols: 10,
    occupiedTarget: 55,
    warehouseStock: [
      { productId: pCoat.id, quantity: 890 },
      { productId: pBag.id, quantity: 760 },
    ],
    inboundPartners: ['Mediterranean Freight Lines'],
    outboundPartners: ['Herzliya Express Depot', 'Jerusalem Mall Store'],
    refPrefix: 'ASD',
  });

  console.log('Seed completed! Default login: admin@apex-wms.com / Admin123!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
