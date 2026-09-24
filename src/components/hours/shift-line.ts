/** Props of one shift reference line: solid when it is the person's own, dashed otherwise (#101). */
export function shiftLineProps(y: number, own: boolean, label: string) {
  const color = own ? 'var(--primary)' : 'var(--muted-foreground)'
  return {
    y,
    stroke: color,
    strokeDasharray: own ? undefined : '4 4',
    strokeWidth: own ? 2 : 1,
    label: { value: label, position: 'insideTopRight' as const, fontSize: 11, fill: color },
  }
}
