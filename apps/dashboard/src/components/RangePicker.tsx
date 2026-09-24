import { Button, Popover } from "@mantine/core"
import { DatePicker } from "@mantine/dates"
import { IconCalendar, IconChevronDown } from "@tabler/icons-react"
import dayjs from "dayjs"
import { useState } from "react"

export type DateRange = [string | null, string | null]

const FMT = "YYYY-MM-DD"

// Shared default (last 7 days) so every page starts on the same range.
export const defaultRange: DateRange = [dayjs().subtract(6, "day").format(FMT), dayjs().format(FMT)]

// Convert a picker date (YYYY-MM-DD) to the DD-MM-YYYY the Shopee APIs expect.
export function toShopeeDate(isoDate: string): string {
  return dayjs(isoDate).format("DD-MM-YYYY")
}

function preset(startOffset: number, endOffset = 0): DateRange {
  return [
    dayjs().subtract(startOffset, "day").format(FMT),
    dayjs().subtract(endOffset, "day").format(FMT),
  ]
}

const presets: { value: DateRange; label: string }[] = [
  { value: preset(0, 0), label: "Hari Ini" },
  { value: preset(1, 1), label: "Kemarin" },
  { value: preset(6, 0), label: "1 Minggu Terakhir" },
  { value: [dayjs().subtract(1, "month").format(FMT), dayjs().format(FMT)], label: "1 Bulan Terakhir" },
  { value: [dayjs().subtract(3, "month").format(FMT), dayjs().format(FMT)], label: "3 Bulan Terakhir" },
]

function label(range: DateRange): string {
  const [start, end] = range
  if (start === null || end === null) return "Pilih rentang tanggal"
  const match = presets.find((entry) => entry.value[0] === start && entry.value[1] === end)
  if (match) return match.label
  const startLabel = dayjs(start).format("D MMM YYYY")
  const endLabel = dayjs(end).format("D MMM YYYY")
  return start === end ? startLabel : `${startLabel} – ${endLabel}`
}

export function RangePicker({
  value,
  onChange,
}: {
  value: DateRange
  onChange: (range: DateRange) => void
}) {
  const [opened, setOpened] = useState(false)

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" shadow="md" radius="md">
      <Popover.Target>
        <Button
          variant="default"
          radius="md"
          leftSection={<IconCalendar size={16} />}
          rightSection={<IconChevronDown size={15} />}
          onClick={() => setOpened((current) => !current)}
        >
          {label(value)}
        </Button>
      </Popover.Target>
      <Popover.Dropdown p="sm">
        <DatePicker
          type="range"
          numberOfColumns={2}
          maxDate={dayjs().format(FMT)}
          presets={presets}
          allowSingleDateInRange
          value={value}
          onChange={(range) => {
            const next = range as DateRange
            onChange(next)
            if (next[0] !== null && next[1] !== null) setOpened(false)
          }}
        />
      </Popover.Dropdown>
    </Popover>
  )
}
