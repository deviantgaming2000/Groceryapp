declare module "zipcodes" {
  interface ZipInfo {
    zip: string;
    city: string;
    state: string;
    latitude: number;
    longitude: number;
    country: string;
  }
  export function lookup(zip: string | number): ZipInfo | undefined;
}
