"use client";
export default function ProductionError({ reset }: { reset: () => void }) {
  return <section className="app-shell"><h1>Отчёт временно недоступен</h1><p>Не удалось открыть данные отчётов. Сохранённые версии и черновик в браузере остаются на месте.</p><button className="ghost" onClick={reset}>Попробовать снова</button></section>;
}
