package com.southair.genshin.module.wish.dto;

/** 收藏图鉴条目：按名称 / 类型 / 星级聚合。 */
public class CollectionItemVO {

    private String itemName;
    private String itemType;
    private Integer rarity;
    private Integer count;

    public String getItemName() {
        return itemName;
    }

    public void setItemName(String itemName) {
        this.itemName = itemName;
    }

    public String getItemType() {
        return itemType;
    }

    public void setItemType(String itemType) {
        this.itemType = itemType;
    }

    public Integer getRarity() {
        return rarity;
    }

    public void setRarity(Integer rarity) {
        this.rarity = rarity;
    }

    public Integer getCount() {
        return count;
    }

    public void setCount(Integer count) {
        this.count = count;
    }
}
