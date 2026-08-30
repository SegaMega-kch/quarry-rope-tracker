import { deleteRopeTypeAction, saveLocationAction, saveRopeTypeAction } from "./actions";
import { restoreLocationAction } from "./location-actions";
import { LocationArchiveForm } from "./LocationArchiveForm";
import { canCreateExcavator, canExport, canManageLocationArchive, canManageLocations, canManageRopeTypes } from "@/lib/permissions";
import { categoryLabels, locationLabel, ropeTypeLabel } from "@/lib/labels";
import { ManagementDialog, ManagementForm, ManagementSection } from "./Management";
import { ClearAllRopesButton } from "./ClearAllRopesButton";

export function RopeManagement({ role, locations, archivedLocations, ropeTypes, occupiedTypeIds }: {
  role: string;
  locations: { id: number; name: string; category: string }[];
  archivedLocations: { id: number; name: string; category: string }[];
  ropeTypes: { id: number; name: string; standardLength: number; defaultDiameter: string | null }[];
  occupiedTypeIds: number[];
}) {
  const manageLocations = canManageLocations(role);
  const removableTypes = ropeTypes.filter((type) => !occupiedTypeIds.includes(type.id));
  if (!canCreateExcavator(role) && !canManageRopeTypes(role) && !canExport(role)) return null;
  return <ManagementSection>
    {canCreateExcavator(role) ? <ManagementDialog title="Добавить экскаватор" kind="add">
      <ManagementForm action={saveLocationAction}>
        <input type="hidden" name="category" value="excavator" />
        <label>Название экскаватора<input name="name" placeholder="Например: ЭКГ-10 №12" required /></label>
        <button type="submit" className="primary">Добавить экскаватор</button>
      </ManagementForm>
    </ManagementDialog> : null}
    {canManageLocationArchive(role) ? <>
      <ManagementDialog title="Удалить экскаватор" kind="delete"><LocationArchiveForm locations={locations} excavator /></ManagementDialog>
      <ManagementDialog title="Добавить место" kind="add">
        <ManagementForm action={saveLocationAction}>
          <label>Название<input name="name" required /></label>
          <label>Категория<select name="category">{Object.entries(categoryLabels).filter(([key]) => key !== "excavator").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <button type="submit" className="primary">Добавить место</button>
        </ManagementForm>
      </ManagementDialog>
      {manageLocations ? <ManagementDialog title="Редактировать места">
        <div className="list">{locations.map((location) => <ManagementForm action={saveLocationAction} className="edit-location" key={location.id}>
          <input type="hidden" name="id" value={location.id} />
          <label>Название<input name="name" defaultValue={location.name} required /></label>
          <input type="hidden" name="category" value={location.category} />
          <button type="submit">Сохранить</button>
        </ManagementForm>)}</div>
      </ManagementDialog> : null}
      <ManagementDialog title="Удалить место" kind="delete">
        <LocationArchiveForm locations={locations} excavator={false} />
      </ManagementDialog>
      <ManagementDialog title="Архив">
        {archivedLocations.length ? <ManagementForm action={restoreLocationAction}>
          <label>Экскаватор или место<select name="id" required defaultValue=""><option value="" disabled>Выберите из архива</option>{archivedLocations.map((place) => <option key={place.id} value={place.id}>{locationLabel(place.name)}</option>)}</select></label>
          <p>Сохранённые данные восстановятся. Перемещённое имущество останется на текущих местах.</p>
          <button type="submit" className="primary">Восстановить</button>
        </ManagementForm> : <p>Архив пуст</p>}
      </ManagementDialog>
    </> : null}
    {canManageRopeTypes(role) ? <>
      <ManagementDialog title="Добавить тип каната" kind="add">
        <ManagementForm action={saveRopeTypeAction}>
          <label>Название<input name="name" placeholder="Например: Подъём ЭКГ-15" required /></label>
          <label>Стандартная длина, м<input name="standardLength" type="number" min="1" required /></label>
          <label>Диаметр<input name="defaultDiameter" placeholder="Например: 45 мм" required /></label>
          <button type="submit" className="primary">Добавить тип каната</button>
        </ManagementForm>
      </ManagementDialog>
      <ManagementDialog title="Удалить тип каната" kind="delete">
        {removableTypes.length ? <ManagementForm action={deleteRopeTypeAction} message="Убрать тип каната из списков? История сохранится.">
          <label>Тип каната<select name="id" required defaultValue=""><option value="" disabled>Выберите тип</option>{removableTypes.map((type) => <option key={type.id} value={type.id}>{ropeTypeLabel(type.name)}, {type.standardLength} м, {type.defaultDiameter}</option>)}</select></label>
          <button type="submit" className="danger">Удалить тип каната</button>
        </ManagementForm> : <p className="muted">Нет типов каната, доступных для удаления.</p>}
        <p className="muted">Типы с канатами в учёте, в том числе выданными в долг, защищены от удаления.</p>
      </ManagementDialog>
    </> : null}
    {canExport(role) ? <ManagementDialog title="Excel-отчёты">
      <div className="form">
        <a className="link-button" href="/reports/current">Текущий остаток .xlsx</a>
        <form action="/reports/month" method="get" className="form">
          <label>Месяц<input name="month" type="month" defaultValue={new Date().toISOString().slice(0, 7)} required /></label>
          <button type="submit">Движение за месяц .xlsx</button>
        </form>
      </div>
    </ManagementDialog> : null}
    {role === "storekeeper" ? <ManagementDialog title="Очистка данных" kind="delete">
      <p className="danger-note">Будут удалены все канаты и вся история. Пользователи, места, типы канатов, вертушки и заявки останутся.</p>
      <ClearAllRopesButton />
    </ManagementDialog> : null}
  </ManagementSection>;
}
