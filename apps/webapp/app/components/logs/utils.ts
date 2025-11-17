import { formatString } from "~/lib/utils";

export const getStatusColor = (status: string) => {
  switch (status) {
    case "PROCESSING":
      return "#3F8EF7";
    case "PENDING":
      return "#F5BD46";
    case "COMPLETED":
      return "#55A271";
    case "FAILED":
      return "#D45453";
    case "CANCELLED":
      return "#000000";
    default:
      return "#000000";
  }
};

export function getStatusValue(status: string) {
  if (status === "PENDING") {
    return formatString("In Queue");
  }

  return formatString(status);
}
