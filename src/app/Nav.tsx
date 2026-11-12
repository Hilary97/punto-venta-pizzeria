import { useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorBanner } from "../shared/ui/ErrorBanner";
import { toUserMessage } from "../shared/errors";
import { NavLink, matchPath, useLocation } from "react-router";
import { cn } from "../shared/ui/cn";
import { signOut } from "../features/auth/infrastructure/authRepository";
import { useAuth } from "../features/auth/ui/AuthContext";
import { ThemeToggle } from "../shared/theme/ThemeToggle";
import {
  ChevronIcon,
  DeliveryIcon,
  KitchenIcon,
  MoreIcon,
  OrdersIcon,
  SaleIcon,
} from "./navIcons";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-red-700";

// Top tab on sm+, icon-over-label tab on phones. The indicator is a ::before bar.
const TAB_BASE = cn(
  "relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-semibold whitespace-nowrap transition-colors",
  "sm:h-16 sm:flex-none sm:flex-row sm:gap-0 sm:px-4 sm:text-sm",
  "before:absolute before:inset-x-4 before:top-0 before:h-[3px] before:rounded-b-full",
  "sm:before:inset-x-0 sm:before:top-auto sm:before:bottom-0 sm:before:rounded-none",
  FOCUS,
);
const tabClass = (active: boolean) =>
  cn(TAB_BASE, active ? "text-red-700 before:bg-red-700" : "text-slate-600 hover:text-slate-900");
const TAB_LINK_CLASS = ({ isActive }: { isActive: boolean }) => tabClass(isActive);

const MENU_LINK_CLASS = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold",
    FOCUS,
    isActive ? "bg-red-50 text-red-700" : "text-slate-700 hover:bg-slate-100",
  );

type MenuLink = { to: string; label: string };
type MenuGroup = { heading: string; links: MenuLink[] };

function PrimaryTab({ to, end, icon, children }: { to: string; end?: boolean; icon: ReactNode; children: string }) {
  return (
    <NavLink to={to} end={end} className={TAB_LINK_CLASS}>
      <span className="sm:hidden">{icon}</span>
      {children}
    </NavLink>
  );
}

export function Nav() {
  const { profile } = useAuth();
  const { pathname } = useLocation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Menu is open only for the path it was opened on, so any route change closes it.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const moreRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const isWaiter = profile?.role === "waiter";
  const isAdmin = profile?.role === "admin";

  const groups: MenuGroup[] = [];
  if (!isWaiter) {
    groups.push({
      heading: "Caja",
      links: [
        { to: "/historial-ventas", label: "Historial de Ventas" },
        { to: "/corte", label: "Corte de caja" },
      ],
    });
  }
  if (isAdmin) {
    groups.push({
      heading: "Administración",
      links: [
        { to: "/admin/productos", label: "Productos" },
        { to: "/admin/inventario", label: "Inventario" },
        { to: "/admin/insumos", label: "Insumos" },
        { to: "/admin/pizzas", label: "Pizzas" },
        { to: "/admin/historial", label: "Historial de Cortes" },
        { to: "/admin/meseros", label: "Meseros" },
      ],
    });
  }
  const hasMenuLinks = groups.length > 0;
  const moreActive = groups.some((g) => g.links.some((l) => matchPath(l.to, pathname)));

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenedAt(null);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setOpenedAt(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  async function handleSignOut() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await signOut();
    } catch (error) {
      setError(toUserMessage(error));
    } finally {
      setPending(false);
    }
  }

  const signOutButton = (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      className={cn(
        "min-h-11 rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100",
        FOCUS,
      )}
    >
      {pending ? "Cerrando sesión…" : "Salir"}
    </button>
  );

  return (
    <nav
      aria-label="Principal"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_3px_rgb(0_0_0/0.06)]",
        "sm:static sm:flex sm:h-16 sm:items-center sm:justify-between sm:gap-2 sm:border-t-0 sm:border-b sm:px-4 sm:pb-0 sm:shadow-sm",
      )}
    >
      <div className="flex h-[68px] items-stretch sm:h-full">
        {!isWaiter && (
          <PrimaryTab to="/" end icon={<SaleIcon />}>
            Venta
          </PrimaryTab>
        )}
        <PrimaryTab to="/pedidos" icon={<OrdersIcon />}>
          Pedidos
        </PrimaryTab>
        {!isWaiter && (
          <>
            <PrimaryTab to="/cocina" icon={<KitchenIcon />}>
              Cocina
            </PrimaryTab>
            <PrimaryTab to="/entrega" icon={<DeliveryIcon />}>
              Entrega
            </PrimaryTab>
          </>
        )}
        <div ref={moreRef} className={cn("relative flex flex-1 sm:flex-none", !hasMenuLinks && "sm:hidden")}>
          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls="nav-more-menu"
            aria-current={moreActive ? "true" : undefined}
            onClick={() => setOpenedAt(open ? null : pathname)}
            className={cn(tabClass(moreActive || open), "w-full")}
          >
            <span className="sm:hidden">
              <MoreIcon />
            </span>
            Más
            <span className="ml-1 hidden sm:inline">
              <ChevronIcon />
            </span>
          </button>
          {open && (
            <div
              id="nav-more-menu"
              className={cn(
                "absolute right-2 bottom-full z-50 mb-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg",
                "sm:top-full sm:right-auto sm:bottom-auto sm:left-0 sm:mt-1 sm:mb-0",
              )}
            >
              {groups.map((group) => (
                <div key={group.heading} className="pb-1">
                  <p className="px-3 pt-2 pb-1 text-xs font-bold tracking-wide text-slate-500 uppercase">
                    {group.heading}
                  </p>
                  {group.links.map((link) => (
                    <NavLink
                      key={link.to}
                      to={link.to}
                      className={MENU_LINK_CLASS}
                      onClick={() => setOpenedAt(null)}
                    >
                      {link.label}
                    </NavLink>
                  ))}
                </div>
              ))}
              <div className="border-t border-slate-200 pt-2 sm:hidden">
                {profile && (
                  <p className="px-3 pb-1 text-sm font-semibold text-slate-700">{profile.fullName}</p>
                )}
                <div className="flex items-center justify-between gap-2 px-1">
                  <ThemeToggle />
                  {signOutButton}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="hidden items-center gap-3 sm:flex">
        <ThemeToggle />
        {profile && <span className="text-sm text-slate-500">{profile.fullName}</span>}
        {signOutButton}
      </div>
      {error && (
        <div className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 sm:static sm:inset-auto">
          <ErrorBanner message={error} />
        </div>
      )}
    </nav>
  );
}
