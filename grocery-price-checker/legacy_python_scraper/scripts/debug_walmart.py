import argparse
import asyncio

from app.providers.walmart import WalmartProvider


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("query")
    parser.add_argument("--zip", required=True, dest="zip_code")
    args = parser.parse_args()
    results = await WalmartProvider().search_item(args.query, args.zip_code)
    print(f"Store: Walmart")
    print(f"Query: {args.query}")
    print(f"ZIP: {args.zip_code}")
    print(f"Parsed ProductResult objects: {len(results)}")
    for result in results:
        print(result.model_dump_json(indent=2))


if __name__ == "__main__":
    asyncio.run(main())

