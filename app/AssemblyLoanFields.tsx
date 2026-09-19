"use client";

import { useState } from "react";

export function AssemblyLoanFields({ name, label, options, submit }: {
  name: "recipient" | "horizonId"; label: string; options: Array<{ value: string; label: string }>; submit: string;
}) {
  const [selected, setSelected] = useState("");
  return <>
    <label>{label}
      <select name={name} required value={selected} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Выберите</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    <button className="primary big" type="submit" disabled={!selected}>{submit}</button>
  </>;
}
