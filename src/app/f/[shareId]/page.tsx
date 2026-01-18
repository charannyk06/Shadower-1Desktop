import { Metadata } from "next";
import { notFound } from "next/navigation";
import { deploymentService } from "lib/ai/fragments/deployment-service";
import { FragmentViewer } from "./fragment-viewer";

interface PageProps {
  params: Promise<{ shareId: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { shareId } = await params;

  try {
    const data = await deploymentService.getPublicFragment(shareId);

    if (!data) {
      return {
        title: "Fragment Not Found | Shadower",
        description: "This fragment may have expired or been removed.",
      };
    }

    return {
      title: `${data.fragment.title} | Shadower`,
      description:
        data.fragment.description ||
        `A ${data.fragment.template} app created with Shadower AI`,
      openGraph: {
        title: data.fragment.title,
        description:
          data.fragment.description ||
          `A ${data.fragment.template} app created with Shadower AI`,
        type: "website",
      },
    };
  } catch {
    return {
      title: "Fragment | Shadower",
    };
  }
}

export default async function PublicFragmentPage({ params }: PageProps) {
  const { shareId } = await params;

  const data = await deploymentService.getPublicFragment(shareId);

  if (!data) {
    notFound();
  }

  return <FragmentViewer fragment={data.fragment} share={data.share} />;
}
