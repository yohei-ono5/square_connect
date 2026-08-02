import { describe, expect, it } from "vitest";
import type { MockItem } from "../store/ItemsContext";
import { getSquareSyncStatus, isSquareItemSoldOut } from "./StatusBadge";

function item(overrides: Partial<MockItem> = {}): MockItem {
  return {
    id: "item-1",
    storeId: "store-1",
    status: "pushed",
    mgmtNo: "00001",
    title: "Tシャツ",
    price: 3000,
    inventoryCount: 1,
    gender: null,
    category: null,
    categoryId: null,
    size: null,
    condition: null,
    measurements: null,
    description: null,
    squareObjectId: "square-item-1",
    updatedAt: "2026-07-22T01:00:00.000Z",
    squareSyncedAt: "2026-07-22T01:00:00.000Z",
    squareDeletedAt: null,
    photos: [],
    ...overrides,
  };
}

describe("getSquareSyncStatus", () => {
  it("marks an item without a Square ID as unregistered", () => {
    expect(getSquareSyncStatus(item({ squareObjectId: null }))).toBe("unregistered");
  });

  it("marks locally updated content as pending", () => {
    expect(getSquareSyncStatus(item({ updatedAt: "2026-07-22T01:01:00.000Z" }))).toBe("pending");
  });

  it("marks a photo without a Square image ID as pending", () => {
    expect(getSquareSyncStatus(item({
      photos: [{
        id: "photo-1",
        itemId: "item-1",
        role: "main",
        storagePath: "items/item-1/photo-1.jpg",
        previewUrl: "/media/items/item-1/photo-1.jpg",
        squareImageId: null,
        pendingDelete: false,
      }],
    }))).toBe("pending");
  });

  it("marks a photo staged for deletion as pending", () => {
    expect(getSquareSyncStatus(item({
      photos: [{
        id: "photo-1",
        itemId: "item-1",
        role: "main",
        storagePath: "items/item-1/photo-1.jpg",
        previewUrl: "/media/items/item-1/photo-1.jpg",
        squareImageId: "square-image-1",
        pendingDelete: true,
      }],
    }))).toBe("pending");
  });

  it("marks matching timestamps and photos as reflected", () => {
    expect(getSquareSyncStatus(item())).toBe("reflected");
  });

  it("prioritizes a Square deletion over the sync timestamp", () => {
    expect(getSquareSyncStatus(item({ squareDeletedAt: "2026-07-22T02:00:00.000Z" }))).toBe("deleted");
  });
});

describe("isSquareItemSoldOut", () => {
  it("marks a Square-registered item with zero inventory as sold out", () => {
    expect(isSquareItemSoldOut(item({ inventoryCount: 0 }))).toBe(true);
  });

  it("does not mark an item with inventory as sold out", () => {
    expect(isSquareItemSoldOut(item({ inventoryCount: 1 }))).toBe(false);
  });

  it("does not mark an unregistered draft as sold out", () => {
    expect(isSquareItemSoldOut(item({ squareObjectId: null, inventoryCount: 0 }))).toBe(false);
  });

  it("does not add a sold-out state to an item deleted from Square", () => {
    expect(isSquareItemSoldOut(item({
      inventoryCount: 0,
      squareDeletedAt: "2026-07-22T02:00:00.000Z",
    }))).toBe(false);
  });
});
