/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
declare module "recharts" {
  export const ResponsiveContainer: React.ComponentType<any>;
  export const LineChart: React.ComponentType<any>;
  export const Line: React.ComponentType<any>;
  export const XAxis: React.ComponentType<any>;
  export const YAxis: React.ComponentType<any>;
  export const Tooltip: React.ComponentType<any>;
  export const BarChart: React.ComponentType<any>;
  export const Bar: React.ComponentType<any>;
  export const PieChart: React.ComponentType<any>;
  export const Pie: React.ComponentType<any>;
  export const Cell: React.ComponentType<any>;
}
