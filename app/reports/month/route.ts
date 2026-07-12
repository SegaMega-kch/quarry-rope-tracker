import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { canExport, requireUser } from "@/lib/auth";
import { actionLabels, ropeTypeLabel } from "@/lib/labels";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const user = await requireUser();
  if (!canExport(user.role)) return new NextResponse("Недостаточно прав", { status: 403 });

  const month = request.nextUrl.searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const [year, monthIndex] = month.split("-").map(Number);
  const from = new Date(year, monthIndex - 1, 1);
  const to = new Date(year, monthIndex, 1);

  const movements = await prisma.ropeMovement.findMany({
    where: { createdAt: { gte: from, lt: to } },
    include: { user: true, ropeType: true, fromLocation: true, toLocation: true },
    orderBy: { createdAt: "asc" }
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Движение");
  sheet.columns = [
    { header: "Дата", key: "date", width: 22 },
    { header: "Пользователь", key: "user", width: 18 },
    { header: "Действие", key: "action", width: 28 },
    { header: "Тип каната", key: "type", width: 24 },
    { header: "Диаметр", key: "diameter", width: 12 },
    { header: "Длина", key: "length", width: 10 },
    { header: "Количество", key: "quantity", width: 12 },
    { header: "Откуда", key: "from", width: 26 },
    { header: "Куда", key: "to", width: 26 },
    { header: "Комментарий", key: "comment", width: 34 }
  ];

  movements.forEach((movement) => {
    sheet.addRow({
      date: movement.createdAt,
      user: movement.user.login,
      action: actionLabels[movement.action],
      type: ropeTypeLabel(movement.ropeType?.name),
      diameter: movement.diameter ?? "",
      length: movement.length ?? "",
      quantity: movement.quantity,
      from: movement.fromLocation?.name ?? "",
      to: movement.toLocation?.name ?? "",
      comment: movement.comment ?? ""
    });
  });
  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=rope-movement-${month}.xlsx`
    }
  });
}
