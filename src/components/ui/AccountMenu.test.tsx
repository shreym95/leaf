import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountMenu } from "./AccountMenu";

// jsdom doesn't implement form submission; spy on it so we can assert the
// sign-out POST is actually triggered.
const submitted: HTMLFormElement[] = [];

beforeEach(() => {
  submitted.length = 0;
  HTMLFormElement.prototype.requestSubmit = vi.fn(function (
    this: HTMLFormElement,
  ) {
    submitted.push(this);
  });
});

describe("AccountMenu", () => {
  it("signs out via a POST form — not a link", async () => {
    // Regression: the form used to live inside the Radix MenuItem, and closing
    // the menu unmounted it before the browser could submit. Nothing happened.
    const user = userEvent.setup();
    render(<AccountMenu name="Reader Person" />);

    await user.click(screen.getByRole("button", { name: /account menu/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].getAttribute("action")).toBe("/auth/signout");
    expect(submitted[0].getAttribute("method")).toBe("post");
  });

  it("keeps the sign-out form outside the menu so closing can't tear it out", () => {
    const { container } = render(<AccountMenu name="Reader Person" />);
    const form = container.querySelector('form[action="/auth/signout"]');
    expect(form).not.toBeNull();
    expect(form?.closest("[role=menu]")).toBeNull();
  });

  it("offers sign-in instead when signed out, with no sign-out form", async () => {
    const user = userEvent.setup();
    const { container } = render(<AccountMenu name={null} />);

    await user.click(screen.getByRole("button", { name: "Menu" }));

    expect(await screen.findByRole("menuitem", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).toBeNull();
    expect(container.querySelector('form[action="/auth/signout"]')).toBeNull();
  });

  it("keeps Library and Settings out of the menu when signed out", async () => {
    const user = userEvent.setup();
    render(<AccountMenu name={null} />);

    await user.click(screen.getByRole("button", { name: "Menu" }));

    expect(await screen.findByRole("menuitem", { name: "Privacy" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Library" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Settings" })).toBeNull();
  });
});
