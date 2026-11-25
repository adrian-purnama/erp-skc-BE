export type LandingImageOutDto = {
  id: string;
  url: string;
  width: number;
  height: number;
};

export type LandingCategoryOutDto = {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
  postCount: number;
};

export type CreateLandingCategoryDto = {
  label: string;
  slug: string;
};

export type UpdateLandingCategoryDto = {
  label?: string;
  slug?: string;
};

export type LandingPostOutDto = {
  id: string;
  categoryId: string;
  slug: string;
  title: string;
  place: string;
  featured: boolean;
  published: boolean;
  cover: LandingImageOutDto | null;
  logo: LandingImageOutDto | null;
  gallery: LandingImageOutDto[];
  updatedAt: string | null;
};

export type CreateLandingPostDto = {
  categoryId: string;
  title: string;
  place: string;
  slug: string;
  featured: boolean;
  published: boolean;
};

export type UpdateLandingPostDto = Partial<CreateLandingPostDto>;

/** Image role decides the size and quality of the WebP we store. */
export type LandingImageRole = "cover" | "logo" | "gallery";

/** What the public website reads (published posts with a cover only). */
export type PublicLandingDto = {
  categories: { slug: string; label: string }[];
  posts: {
    slug: string;
    category: string;
    title: string;
    place: string;
    featured: boolean;
    cover: LandingImageOutDto;
    logo: LandingImageOutDto | null;
    gallery: LandingImageOutDto[];
  }[];
};

/** Website "Request a quote" form. */
export type QuoteRequestDto = {
  name: string;
  email: string;
  company: string;
  phone: string;
  service: string;
  location: string;
  message: string;
  /** Honeypot was filled: accept quietly, send nothing. */
  isBot: boolean;
};
