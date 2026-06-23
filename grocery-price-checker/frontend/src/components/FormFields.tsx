export const units = ["each", "lb", "oz", "gallon", "quart", "pint", "fl_oz", "pack", "case", "count"];
export const confidenceLevels = ["confirmed", "estimated", "old", "unknown"];

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props;
  return <label className="field"><span>{label}</span><input {...rest} /></label>;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: string[] }) {
  const { label, options, ...rest } = props;
  return <label className="field"><span>{label}</span><select {...rest}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const { label, ...rest } = props;
  return <label className="field wide"><span>{label}</span><textarea {...rest} /></label>;
}

