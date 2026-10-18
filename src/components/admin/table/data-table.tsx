import type { ComponentProps, ReactNode } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { AdminTableDefinition } from './table-definitions';

/** Universal renderer: feature adapters own data access, authorization and cell content. */
export function AdminDataTable<Row>({
  definition,
  rows,
  cells,
  headers = {},
  rowProps,
  body,
  toolbar,
  footer,
  error,
  empty,
}: {
  definition: AdminTableDefinition<Row>;
  rows: readonly Row[];
  cells: Record<string, (row: Row) => ReactNode>;
  headers?: Record<string, ReactNode>;
  rowProps?: (row: Row) => ComponentProps<typeof TableRow>;
  body?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  error?: ReactNode;
  empty?: ReactNode;
}) {
  return (
    <>
      {toolbar}
      {error ?? (
        <div className="overflow-hidden rounded-lg border" data-admin-table={definition.id}>
          <Table>
            <TableHeader>
              <TableRow>
                {definition.columns.map((column) => (
                  <TableHead key={column.id} className={column.className}>
                    {headers[column.id] ?? column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {body ??
                (rows.length ? (
                  rows.map((row) => (
                    <TableRow key={definition.getRowId(row)} {...rowProps?.(row)}>
                      {definition.columns.map((column) => (
                        <TableCell key={column.id} className={column.className}>
                          {cells[column.id]?.(row)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={definition.columns.length}
                      className="h-empty-row-lg text-center text-muted-foreground"
                    >
                      {empty ?? definition.empty}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}
      {footer}
    </>
  );
}
