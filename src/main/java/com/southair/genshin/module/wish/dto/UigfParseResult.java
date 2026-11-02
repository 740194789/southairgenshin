package com.southair.genshin.module.wish.dto;

import com.southair.genshin.module.wish.WishRecord;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

/**
 * UIGF v4.2 / SRGF v1.0 解析结果：有效记录 + 文件条目总数 + 结构无效条数。
 */
public class UigfParseResult implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 通过结构校验并按记录规则过滤后的记录 */
    private List<WishRecord> records = new ArrayList<>();

    /** 文件中的条目总数（含结构无效与被规则过滤的条目） */
    private int total;

    /** 缺少 uid / name / item_type / rank_type 或 time 格式错误的条数 */
    private int invalid;

    /** 按记录规则忽略的条数（三星物品、四星武器 / 光锥） */
    private int filtered;

    public List<WishRecord> getRecords() {
        return records;
    }

    public void setRecords(List<WishRecord> records) {
        this.records = records;
    }

    public int getTotal() {
        return total;
    }

    public void setTotal(int total) {
        this.total = total;
    }

    public int getInvalid() {
        return invalid;
    }

    public void setInvalid(int invalid) {
        this.invalid = invalid;
    }

    public int getFiltered() {
        return filtered;
    }

    public void setFiltered(int filtered) {
        this.filtered = filtered;
    }
}
