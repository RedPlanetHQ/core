import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { type PersonalAccessToken, useTokensColumns } from "./columns";

export const APITable = ({
  personalAccessTokens,
}: {
  personalAccessTokens: PersonalAccessToken[];
}) => {
  const columns = useTokensColumns();
  const table = useReactTable({
    data: personalAccessTokens,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="bg-background-3 mt-2 rounded p-2">
      <Table className="bg-background-3 rounded-md p-4">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id} className="text-sm">
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
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
                  <TableCell key={cell.id} className="w-[90%] py-1">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <></>
          )}
        </TableBody>
      </Table>
    </div>
  );
};
