package com.southair.genshin.module.wish.dto;

import javax.validation.Valid;
import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.Size;
import java.util.ArrayList;
import java.util.List;

/**
 * 批量编辑请求（仅编辑当前页已存在的记录）。
 */
public class WishBatchRequest {

    @Valid
    @NotEmpty(message = "至少需要一条记录")
    @Size(max = 10, message = "一次最多提交 10 条记录")
    private List<WishRequest> records = new ArrayList<>();

    public List<WishRequest> getRecords() {
        return records;
    }

    public void setRecords(List<WishRequest> records) {
        this.records = records;
    }
}
