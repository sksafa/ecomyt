
import React from "react";
import { NavLink } from "react-router-dom";
import profile from '../../Image/profile.png'
import { useAuth } from "../../context/auth";
const AdminMenu = () => {
  const [auth] = useAuth();
  return (
    <div className="">
      <div className="profileArea text-center">
        <img src={profile} alt="profile imag" />
        <h4>{auth?.user?.name}</h4>
        <h6>{auth?.user?.email}</h6>
        <h6>{auth?.user?.address}</h6>
      </div>
      <div>
        <div className="ProfileNav">
          <div className="list-group border-0">

            <NavLink to="/dashboard/admin" className="list-group-item list-group-item-action" >
              Dashboard
            </NavLink>

            <NavLink to="/dashboard/admin/create-category" className="list-group-item list-group-item-action" >
              Create Category
            </NavLink>

            <NavLink to="/dashboard/admin/create-product" className="list-group-item list-group-item-action">
              Create Product
            </NavLink>
            <NavLink to="/dashboard/admin/products" className="list-group-item list-group-item-action" >
              Products
            </NavLink>

            <NavLink to="/dashboard/admin/orders" className="list-group-item list-group-item-action">
              Orders
            </NavLink>

            <NavLink to="/" className="list-group-item list-group-item-action" >
              Go to Home
            </NavLink>
          </div>

        </div>
      </div>
    </div>
  );
};

export default AdminMenu;