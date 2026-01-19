import { appStore } from "@/app/store";
import { ArchiveWithItemCount } from "app-types/archive";
import { archiveFetcher } from "@/lib/electron/archive-api";
import useSWR from "swr";

export const useArchives = () => {
  return useSWR<ArchiveWithItemCount[]>("/api/archive", archiveFetcher, {
    fallbackData: [],
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    onSuccess: (data) => {
      appStore.setState({
        archiveList: data,
      });
    },
  });
};
