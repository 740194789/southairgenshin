package com.southair.genshin.common;

import org.springframework.data.domain.Page;

import java.io.Serializable;
import java.util.List;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 分页响应结构，屏蔽 Spring Data Page 的内部字段。
 */
public class PageResult<T> implements Serializable {

    private static final long serialVersionUID = 1L;

    private List<T> records;
    /** 总条数 */
    private long total;
    /** 当前页码，从 1 开始 */
    private int page;
    private int size;
    /** 总页数 */
    private int pages;

    public PageResult() {
    }

    public PageResult(List<T> records, long total, int page, int size, int pages) {
        this.records = records;
        this.total = total;
        this.page = page;
        this.size = size;
        this.pages = pages;
    }

    public static <S, T> PageResult<T> of(Page<S> source, Function<S, T> mapper) {
        List<T> records = source.getContent().stream().map(mapper).collect(Collectors.toList());
        return new PageResult<>(records, source.getTotalElements(), source.getNumber() + 1,
                source.getSize(), source.getTotalPages());
    }

    public static <T> PageResult<T> of(Page<T> source) {
        return of(source, Function.identity());
    }

    public List<T> getRecords() {
        return records;
    }

    public void setRecords(List<T> records) {
        this.records = records;
    }

    public long getTotal() {
        return total;
    }

    public void setTotal(long total) {
        this.total = total;
    }

    public int getPage() {
        return page;
    }

    public void setPage(int page) {
        this.page = page;
    }

    public int getSize() {
        return size;
    }

    public void setSize(int size) {
        this.size = size;
    }

    public int getPages() {
        return pages;
    }

    public void setPages(int pages) {
        this.pages = pages;
    }
}
