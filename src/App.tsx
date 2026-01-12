import { useState, useRef } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
import "./App.css";
import { Input } from "./components/ui/input";
import type {
  TextItem,
  TextMarkedContent,
} from "pdfjs-dist/types/src/display/api";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { ColumnDef, SortingState } from "@tanstack/react-table";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "./components/ui/button";
import { Label } from "./components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import * as ics from "ics";
import { saveAs } from "file-saver";
import { DateTime } from "luxon";

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return "str" in item;
}

function split3(str: string, sep: string): [string, string, string] {
  const parts = str.split(sep);
  if (parts.length < 3)
    throw new Error("Input string does not contain at least three parts.");

  const left = parts.shift() as string;
  const right = parts.pop() as string;
  const middle = parts.join(sep);

  return [left, middle, right];
}
function toICSArrayLocal(
  dt: DateTime
): [number, number, number, number, number] {
  const l = dt;
  return [l.year, l.month, l.day, l.hour, l.minute];
}

function toRRuleUntilUTC(dt: DateTime): string {
  return dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
}

const dayToByday: Record<string, string> = {
  Sunday: "SU",
  Monday: "MO",
  Tuesday: "TU",
  Wednesday: "WE",
  Thursday: "TH",
  Friday: "FR",
  Saturday: "SA",
};

const dayToNumber: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

function alignToFirstMatchingWeekday(
  startLocal: DateTime,
  days: string[]
): DateTime {
  if (!days || days.length === 0) return startLocal;

  const targetWeekdays = days
    .map((d) => dayToNumber[d])
    .filter((n): n is number => typeof n === "number");

  let minDelta = Number.POSITIVE_INFINITY;

  for (const target of targetWeekdays) {
    const delta = (target - startLocal.weekday + 7) % 7;
    if (delta < minDelta) {
      minDelta = delta;
    }
  }
  return startLocal.plus({ days: minDelta });
}

export type Course = {
  crn: number;
  title: string;
  details: string;
  start?: DateTime;
  end?: DateTime;
  until?: DateTime;
  day?: string[];
  campus?: string;
  location?: string;
  room?: string;
};

const initialData: Course[] = [
  {
    crn: -1,
    title: "Please upload a schedule",
    details: "-",
  },
];

export const columns: ColumnDef<Course>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => {
      const course = row.original;
      const hasTimeAndDay =
        course.day && course.day.length > 0 && course.start && course.end;

      return (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
          disabled={!hasTimeAndDay}
        />
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => <div>{row.getValue("title")}</div>,
  },
  {
    accessorKey: "details",
    header: "Course Details",
    cell: ({ row }) => (
      <div className="max-w-[200px] truncate">{row.getValue("details")}</div>
    ),
  },
  {
    accessorKey: "crn",
    header: "CRN",
    cell: ({ row }) => <div className="font-medium">{row.getValue("crn")}</div>,
  },
  {
    accessorKey: "day",
    header: "Schedule",
    cell: ({ row }) => {
      const days = row.getValue("day") as string[] | undefined;
      const beginTime = row.original.start?.toFormat("hh:mm a");
      const endTime = row.original.end?.toFormat("hh:mm a");
      return (
        <div className="text-sm">
          <div className={!days || days.length === 0 ? "text-red-500" : ""}>
            {days?.join(", ") || "Unknown"}
          </div>
          <div
            className={`text-muted-foreground ${
              !beginTime || !endTime ? "text-red-500" : ""
            }`}
          >
            {beginTime && endTime ? `${beginTime} - ${endTime}` : "Unknown"}
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "location",
    header: "Location",
    cell: ({ row }) => {
      const campus = row.original.campus;
      const location = row.getValue("location") as string;
      const room = row.original.room;
      return (
        <div className="text-sm">
          <div className={!campus ? "text-red-500" : ""}>
            {campus || "Unknown"}
          </div>
          <div
            className={`text-muted-foreground ${
              !location && !room ? "text-red-500" : ""
            }`}
          >
            {location && room
              ? `${location}, Room ${room}`
              : location || room || "Unknown"}
          </div>
        </div>
      );
    },
  },
];

export function DataTable({
  data,
  onSelectionChange,
}: {
  data: Course[];
  onSelectionChange?: (selectedCourses: Course[]) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "details", desc: false },
  ]);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});

  const handleSelectionChange = (updater: any) => {
    const newSelection =
      typeof updater === "function" ? updater(rowSelection) : updater;
    setRowSelection(newSelection);

    if (onSelectionChange) {
      const selectedCourses = Object.keys(newSelection)
        .filter((key) => newSelection[key])
        .map((index) => data[parseInt(index)])
        .filter(Boolean);
      onSelectionChange(selectedCourses);
    }
  };

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onRowSelectionChange: handleSelectionChange,
    enableRowSelection: (row) => {
      const course = row.original;
      return !!(
        course.day &&
        course.day.length > 0 &&
        course.start &&
        course.end
      );
    },
    state: {
      sorting,
      rowSelection,
    },
  });

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="text-muted-foreground flex-1 text-sm">
          {table.getSelectedRowModel().rows.length} of{" "}
          {table.getRowModel().rows.length} course(s) selected.
        </div>
      </div>
    </div>
  );
}

const App = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [courses, setCourses] = useState<Course[]>(initialData);
  const [filename, setFilename] = useState<string>("");
  const [selectedCourses, setSelectedCourses] = useState<Course[]>([]);

  const handleExtractPDF = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const allRows: string[][] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const rowsMap: Record<string, { x: number; str: string }[]> = {};

      content.items.filter(isTextItem).forEach((item) => {
        const y = Math.round(item.transform[5]);
        (rowsMap[y] ??= []).push({ x: item.transform[4], str: item.str });
      });

      Object.keys(rowsMap)
        .map(Number)
        .sort((a, b) => b - a)
        .forEach((y) => {
          const row = rowsMap[y]
            .sort((a, b) => a.x - b.x)
            .map((cell) => cell.str.trim())
            .filter(Boolean);
          if (row.length) allRows.push(row);
        });
    }

    const headIdx = allRows.findIndex((row) => row[0] === "Title");
    const tailIdx = allRows.findIndex((row) => row[0] === "Total Hours");
    console.log("headIdx:", headIdx, "tailIdx:", tailIdx);
    console.log("allRows:", allRows);
    if (headIdx == -1 || tailIdx == -1 || tailIdx <= headIdx) return;

    for (let i = headIdx - 1; i >= 0; i--) {
      const line = allRows[i][0];
      if (/Schedule$/i.test(line)) {
        setFilename(line);
        break;
      }
    }

    const validRows = allRows.slice(headIdx + 1, tailIdx);
    if (validRows.length === 0) return;

    let currentDateStrings: string[] = [];
    const parsedCourses: Course[] = [];

    type Meeting = {
      day?: string[];
      timeStrings?: [string, string];
      campus?: string;
      location?: string;
      room?: string;
      dateStrings?: string[];
    };

    let baseCourse: Pick<Course, "crn" | "title" | "details"> | null = null;
    let pendingMeeting: Meeting | null = null;

    const dateRangeRegex = /\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}/;

    const finalizeMeeting = () => {
      if (!baseCourse || !pendingMeeting || !pendingMeeting.day) return;

      const dateStrings =
        pendingMeeting.dateStrings && pendingMeeting.dateStrings.length >= 2
          ? pendingMeeting.dateStrings
          : currentDateStrings.length >= 2
          ? currentDateStrings
          : [];

      if (!pendingMeeting.timeStrings || dateStrings.length < 2) return;

      const [startStr, endStr] = pendingMeeting.timeStrings;

      let startLocal = DateTime.fromFormat(
        `${dateStrings[0]} ${startStr}`,
        "MM/dd/yyyy hh:mma",
        { zone: "America/New_York" }
      );
      let endLocal = DateTime.fromFormat(
        `${dateStrings[0]} ${endStr}`,
        "MM/dd/yyyy hh:mma",
        { zone: "America/New_York" }
      );

      const until = DateTime.fromFormat(dateStrings[1], "MM/dd/yyyy", {
        zone: "America/New_York",
      })
        .plus({ days: 1 })
        .minus({ milliseconds: 1 });

      const alignedStart = alignToFirstMatchingWeekday(
        startLocal,
        pendingMeeting.day
      );
      const diffDays = alignedStart
        .startOf("day")
        .diff(startLocal.startOf("day"), "days").days;
      startLocal = startLocal.plus({ days: diffDays });
      endLocal = endLocal.plus({ days: diffDays });

      parsedCourses.push({
        ...baseCourse,
        day: pendingMeeting.day,
        start: startLocal,
        end: endLocal,
        until,
        campus: pendingMeeting.campus,
        location: pendingMeeting.location,
        room: pendingMeeting.room,
      });

      pendingMeeting = null;
    };

    const isDayRow = (text: string) => {
      const days = text.split(",").map((d) => d.trim());
      return days.every((d) => dayToByday[d]);
    };

    const isTimeRow = (text: string) => /:\s*\d{2}\s*[AP]M/i.test(text);

    for (const row of validRows) {
      if ((row.length === 5 || row.length === 6) && row[0] !== "Title") {
        if (row.length === 6) {
          row[4] = `${row[4]}${row[5]}`;
        }
        finalizeMeeting();
        baseCourse = {
          crn: Number(row[3]),
          title: row[0],
          details: row[1],
        };
        pendingMeeting = null;
        currentDateStrings = row[4]
          .split("-", 2)
          .map((dateStr) => dateStr.trim());
      } else {
        const text = row.join(" ").trim();
        if (!text) continue;

        if (dateRangeRegex.test(text)) {
          finalizeMeeting();
          currentDateStrings = text.split("-", 2).map((dateStr) => dateStr.trim());
          pendingMeeting = { ...pendingMeeting, dateStrings: currentDateStrings };
          continue;
        }

        if (isDayRow(text)) {
          if (pendingMeeting && pendingMeeting.day && pendingMeeting.timeStrings) {
            finalizeMeeting();
          }
          pendingMeeting = {
            ...pendingMeeting,
            day: text.split(",").map((str) => str.trim()),
          };
          continue;
        }

        if (isTimeRow(text)) {
          const timeStrings = text
            .replace(/\s+/g, "")
            .split("-", 2)
            .map((timeStr) => timeStr.trim()) as [string, string];
          pendingMeeting = {
            ...pendingMeeting,
            timeStrings,
          };
          continue;
        }

        // Only treat as location if:
        // 1. It has not been set yet (pendingMeeting.room is undefined)
        // 2. AND either contains "*" (campus indicator) or is not a person name pattern
        if (
          row.length === 1 &&
          text.includes(",") &&
          !pendingMeeting?.room
        ) {
          // Check if this looks like a location (contains * or digits for room) 
          // vs a name (no * and no digits after comma)
          const hasAsterisk = text.includes("*");
          const hasRoomNumber = /,\s*\d+/.test(text);
          
          if (hasAsterisk || hasRoomNumber) {
            const meetingDraft: Meeting = { ...pendingMeeting };
            try {
              [meetingDraft.campus, meetingDraft.location, meetingDraft.room] = split3(
                text,
                ","
              ).map((str) => str.trim());
            } catch {
              meetingDraft.location = text;
            }
            pendingMeeting = meetingDraft;
          }
          // Otherwise skip (likely a professor name)
        }
      }
    }

    finalizeMeeting();
    setCourses(parsedCourses);
  };

  const handleDownload = () => {
    if (selectedCourses.length === 0) {
      alert("Please select at least one course to export.");
      return;
    }

    const events = selectedCourses
      .map((course) => {
        if (!course.day || !course.start || !course.end || !course.until)
          return null;

        const byDays = course.day.map((day) => dayToByday[day]).join(",");

        const untilString = toRRuleUntilUTC(course.until);
        const rruleString = `FREQ=WEEKLY;BYDAY=${byDays};INTERVAL=1;UNTIL=${untilString}`;
        const location =
          [course.location, course.room].filter(Boolean).join(", ") ||
          undefined;

        return {
          title: course.details,
          description: `${course.title}`,
          start: toICSArrayLocal(course.start),
          startInputType: "local" as const,
          startOutputType: "local" as const,
          end: toICSArrayLocal(course.end),
          endInputType: "local" as const,
          endOutputType: "local" as const,
          location: location,
          recurrenceRule: rruleString,
          transp: "OPAQUE" as const,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    const headerAttributes = {
      productId: "OSCAR to ICS//EN",
      method: "PUBLISH",
      calName: filename || "Schedule",
    };

    const { error, value } = ics.createEvents(events, headerAttributes);

    if (error) {
      console.error("Error generating ICS file:", error);
      alert("Error generating ICS file, please check the console");
      return;
    }

    if (value) {
      const blob = new Blob([value], { type: "text/calendar;charset=utf-8" });
      const downloadFilename = `${filename || "Schedule"}.ics`;
      saveAs(blob, downloadFilename);
    }
  };

  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-center text-4xl font-extrabold tracking-tight">
            OSCAR to ICS
          </CardTitle>
          <CardDescription className="text-center">
            Convert your OSCAR PDF schedule to ICS calendar format
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-12">
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0">
                1. Upload your PDF schedule from OSCAR
              </h2>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="link" size="sm">
                    Help
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>
                      How to download your PDF schedule from OSCAR
                    </DialogTitle>
                    <DialogDescription>
                      Follow these steps to get your schedule from OSCAR:
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="text-sm text-gray-600">
                      <ol className="list-decimal list-inside space-y-2">
                        <li>Log in to OSCAR</li>
                        <li>Click "Student"</li>
                        <li>Click "Registration"</li>
                        <li>Click "View Registration Information"</li>
                        <li>
                          Inside the "Look Up a Schedule" tab, select the
                          current semester from the drop-down
                        </li>
                        <li>
                          Click the print icon at the top right and save the PDF
                        </li>
                      </ol>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <img
                        src="/oscar-example.jpg"
                        alt="OSCAR schedule example"
                        className="w-full h-auto rounded border"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                          const nextElement = e.currentTarget
                            .nextElementSibling as HTMLElement;
                          if (nextElement) {
                            nextElement.style.display = "block";
                          }
                        }}
                      />
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <Input
              type="file"
              accept="application/pdf"
              ref={fileInputRef}
              onChange={handleExtractPDF}
            />
          </div>

          <div>
            <h2 className="scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0 mb-6">
              2. Select one or more courses to export
            </h2>
            <DataTable data={courses} onSelectionChange={setSelectedCourses} />
          </div>
        </CardContent>
        <CardFooter>
          <div className="w-full">
            <h2 className="scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0 mb-6">
              3. Download and install the ICS file to your calendar
            </h2>
            <div className="flex w-full max-w-sm items-center gap-2">
              <Label htmlFor="filename">Filename</Label>
              <Input
                id="filename"
                placeholder="Schedule"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
              />
              <Button type="button" variant="outline" onClick={handleDownload}>
                Download
              </Button>
            </div>
          </div>
        </CardFooter>
      </Card>
      <div className="text-center mt-8 text-sm text-muted-foreground">
        <p>
          View source on{" "}
          <a
            href="https://github.com/zilongpa/oscar2ics"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline font-medium"
          >
            GitHub
          </a>
        </p>
      </div>
    </div>
  );
};

export default App;
