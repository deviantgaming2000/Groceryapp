export type TravelSettings = {
  vehicleMpg: number;
  gasPricePerGallon: number;
  roundTrip: boolean;
  costPerMileOverride?: number | null;
};

export function drivingCost(oneWayMiles: number | null | undefined, settings: TravelSettings) {
  if (!oneWayMiles || oneWayMiles <= 0) {
    return { roundTripMiles: 0, drivingCost: 0, warning: "Distance missing; driving cost not included" };
  }
  const miles = settings.roundTrip ? oneWayMiles * 2 : oneWayMiles;
  if (settings.costPerMileOverride != null) {
    return { roundTripMiles: miles, drivingCost: miles * settings.costPerMileOverride };
  }
  if (settings.vehicleMpg <= 0) throw new Error("MPG must be greater than zero");
  if (settings.gasPricePerGallon < 0) throw new Error("Gas price must be greater than or equal to zero");
  return {
    roundTripMiles: miles,
    drivingCost: (miles / settings.vehicleMpg) * settings.gasPricePerGallon
  };
}

