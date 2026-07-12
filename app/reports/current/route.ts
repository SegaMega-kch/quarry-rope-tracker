import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { canExport, requireUser } from "@/lib/auth";
import { placementLabels, ropeTypeLabel, statusLabels } from "@/lib/labels";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await requireUser();
  if (!canExport(user.role)) return new NextResponse("Недостаточно прав", { status: 403 });

  const stocks = await prisma.ropeStock.findMany({
    where: { quantity: { gt: 0 } },
    include: { ropeType: true, location: true },
    orderBy: [{ ropeType: { name: "asc" } }, { location: { name: "asc" } }]
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Текущий остаток");
  sheet.columns = [
    { header: "Тип каната", key: "type", width: 24 },
    { header: "Диаметр", key: "diameter", width: 12 },
    { header: "Длина", key: "length", width: 10 },
    { header: "Количество", key: "quantity", width: 12 },
    { header: "Местоположение", key: "location", width: 26 },
    { header: "Размещение", key: "placement", width: 18 },
    { header: "Статус", key: "status", width: 28 },
    { header: "Последнее изменение", key: "changed", width: 22 }
  ];

  stocks.forEach((stock) => {
    sheet.addRow({
      type: ropeTypeLabel(stock.ropeType.name),
      diameter: stock.diameter,
      length: stock.length,
      quantity: stock.quantity,
      location: stock.location.name,
      placement: placementLabels[stock.placement],
      status: statusLabels[stock.status],
      changed: stock.lastChangedAt
    });
  });
  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=rope-current.xlsx"
    }
  });
}
